document.getElementById('year').textContent = new Date().getFullYear();

const navToggle = document.getElementById('navToggle');
const navMobile = document.getElementById('navMobile');

navToggle.addEventListener('click', () => {
  const isOpen = navMobile.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

navMobile.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navMobile.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

/* ---------- Help-line chat ---------- */
const chatFab = document.getElementById('chatFab');
const chatWidget = document.getElementById('chatWidget');
const chatClose = document.getElementById('chatClose');
const chatSend = document.getElementById('chatSend');
const chatMessage = document.getElementById('chatMessage');
const chatEmail = document.getElementById('chatEmail');
const chatStatus = document.getElementById('chatStatus');

function setChatOpen(open) {
  chatWidget.classList.toggle('open', open);
  chatFab.classList.toggle('open', open);
  chatFab.setAttribute('aria-expanded', open ? 'true' : 'false');
  chatWidget.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) chatMessage.focus();
}

chatFab.addEventListener('click', () => setChatOpen(!chatWidget.classList.contains('open')));
chatClose.addEventListener('click', () => setChatOpen(false));
chatSend.addEventListener('click', sendHelp);
chatMessage.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendHelp(); }
});

async function sendHelp() {
  const message = chatMessage.value.trim();
  if (!message) {
    chatStatus.textContent = 'Type a message first.';
    chatStatus.className = 'chat-status err';
    return;
  }
  chatStatus.textContent = 'Sending&hellip;';
  chatStatus.className = 'chat-status';
  chatSend.disabled = true;
  // Route to a company's own help-line inbox when the page carries a
  // ?company=<id> query param or a data-company attribute on <body>.
  const companyId = new URLSearchParams(window.location.search).get('company') ||
    (document.body && document.body.getAttribute('data-company')) || '';
  try {
    const res = await fetch('/api/support/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, email: chatEmail.value.trim(), name: chatName.value.trim(), companyId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not send');
    chatStatus.textContent = 'Sent! We\'ll get back to you by email.';
    chatStatus.className = 'chat-status ok';
    chatMessage.value = '';
  } catch (err) {
    chatStatus.textContent = err.message || 'Could not send. Try again.';
    chatStatus.className = 'chat-status err';
  } finally {
    chatSend.disabled = false;
  }
}
