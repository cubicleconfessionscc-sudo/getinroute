GETINROUTE RECOVERY BASELINES
=============================
These are SOURCE-CODE and CONFIGURATION recovery copies taken during the
September 2026 encoding-recovery operation. DO NOT DELETE unless superseded.

server\
  server.js.20260910_021409.bak   server.js after ASCII-encoding recovery (326289 bytes)
  server.js.20260910_021832.bak   server.js second recovery pass (identical size)
  server_20260910010914.bak       server.js BEFORE encoding recovery (last readable copy)

db\
  db.js.20260910_021409.bak       db.js after recovery (25192 bytes)
  db.js.20260910_021832.bak       db.js second recovery pass (identical)
  db_20260910010914.bak           db.js BEFORE recovery (22668 bytes)

env\
  env.js.20260910_021409.bak      env.js after recovery (985 bytes)
  env.js.20260910_021832.bak      env.js second recovery pass (identical)

rawimport\
  rawimport_20260910010914.bak    rawimport.js BEFORE recovery (24288 bytes)

The matching DATABASE snapshots taken at the same time live under
D:\GetInRoute\data\backups\getinroute.db.*.bak (database backup structure),
NOT here. Tiered verified backups live under D:\GetInRoute\backups\.