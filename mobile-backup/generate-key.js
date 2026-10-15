const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const outDir = 'C:/Users/User/Documents';

// Generate 2048-bit RSA key pair
console.log('Generating 2048-bit RSA key pair...');
const keys = forge.pki.rsa.generateKeyPair(2048);

// Create self-signed X.509 certificate
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 30);

const attrs = [
  { name: 'commonName', value: 'GetInRoute Upload Key' },
  { name: 'organizationName', value: 'GetInRoute' },
  { name: 'countryName', value: 'IN' }
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
  { name: 'basicConstraints', cA: false }
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

// Export PEM certificate (this is what you upload to Play Console)
const pemCert = forge.pki.certificateToPem(cert);
fs.writeFileSync(path.join(outDir, 'upload_certificate.pem'), pemCert);
console.log('PEM certificate saved: ' + path.join(outDir, 'upload_certificate.pem'));

// Export PEM public key
const pemPub = forge.pki.publicKeyToPem(keys.publicKey);
fs.writeFileSync(path.join(outDir, 'upload_public.pem'), pemPub);

// Export PKCS12/PFX keystore (for EAS)
const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'getinroute', { algorithm: '3des' });
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
fs.writeFileSync(path.join(outDir, 'upload-keystore.p12'), Buffer.from(p12Der, 'binary'));
console.log('PKCS12 keystore saved: ' + path.join(outDir, 'upload-keystore.p12'));
console.log('Keystore password: getinroute');

// Calculate SHA-256 fingerprint of the certificate
const sha256md = forge.md.sha256.create();
const certDer = forge.asn1.toDer(forge.pki.distinguishedNameToAsn1(cert.subject)).getBytes();
sha256md.update(certDer);
console.log('Done.');
