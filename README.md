# Little by little · Poker maths

A separate personal poker-maths trainer for cash games and tournaments. JavaScript, Node.js and SQLite; no framework or npm dependencies. Mobile-friendly mental answers with reveal/self-rating, plus optional typed answers.

## Start locally

Use Node.js 24 LTS (minimum 22.13). In a terminal:

```powershell
cd C:\Users\David\Documents\Codex\2026-09-19\i\outputs\poker-maths
npm run password
npm start
```

Choose your username and password when prompted, then open **http://127.0.0.1:8766**. No default password is shipped. Run password setup once; future starts only need `npm start`. After source changes, stop with Ctrl+C, run `npm start` again and refresh the page. `npm run dev` restarts automatically when files change.

The mental-maths app can keep running on port 8765. This app uses port 8766, its own `data/poker.sqlite3`, separate cookies and separate browser storage. Do not copy the other app's `.env` or data directory. Optional configuration is shown in `.env.example`.

## Practice

Thirteen skills:

- Chips to BB; BB to chips; effective stack in BB; stack-to-pot ratio.
- Bet as a percentage of the pot; percentage-pot bet sizing; pot after a bet and call.
- Calling equity threshold; your bet facing an all-in raise; an all-in raise when you are shorter; break-even pure-bluff success rate.
- Approximate draw chances with one card to come and with both remaining cards guaranteed.

Choose cash, tournaments or both; any category, individual skill or custom mix. Cash examples use pounds and realistic blind amounts. Tournament examples use chips. All-in raise examples also alternate with BB wording. Changing format keeps your skill progress; cash and tournament versions share the same underlying maths skill.

Questions use a poker table with players, remaining stacks and separate street bets. The centre shows the original pot before the displayed bets, matching the replay convention; add bets/calls yourself. No call amount or equity answer appears before reveal. Other skills use the same layout with only the relevant inputs, while draw estimates use a compact outs panel. Expand “Full text description” for the complete wording or “Practice settings” to change the selection. Graphics are rendered from each question's inputs rather than generated images.

On phones, Show/Check answer and the rating buttons stay pinned at the bottom, with room reserved beneath the content and support for the phone's safe area. Revealing an answer brings its explanation into view; after the rating is saved, the next question automatically returns to the top of the screen. Longer explanations can still be scrolled while the rating controls remain reachable.

Daily rounds contain up to ten questions plus outstanding retries. Free practice lets you continue. Six steps move from friendly amounts/common fractions to mixed stacks and awkward estimates. Harder trials start around one in four examples, rising to one in two after successful trials. Promotion requires four comfortable first attempts across three UTC days and at least 80% comfortable among the latest eight harder first attempts. Retries do not promote. Repeated misses introduce easier support. Scheduling and progression are transparent starting heuristics, not a validated learning model.

Progress shows first-attempt accuracy and median correct-answer time, separated by difficulty and answer mode. Timing does not affect promotion. Detected interruptions and restored questions have no timing; self-marked results rely on your honest rating. The server commits each review once and the browser retains an unsent answer for reconnection. This is not fully offline practice.

Answers also show a Mental shortcut tailored to the current numbers: cancelling zeros, splitting BB amounts, building percentages from halves/quarters or 10%/1%, and using percentage anchors for calling and bluffing odds. These tips appear only after reveal and also work for previously saved questions with scenario data.

## Meaning of the answers

Pot means the pot **before the described bet**. Villain's shove is their **total contribution on this street**, including the amount matching your bet, not a raise by that amount. Stacks are explicitly described as remaining before or after acting.

For a heads-up all-in raise: let `P` be the pot before your bet, `B` your bet, `S` villain's total shove and `H` your total available street contribution (your bet plus remaining stack). The matched total is `M = min(S, H)`. Your extra call is `M − B`, the final matched pot is `P + 2M`, and the chip-equity threshold is `(M − B) / (P + 2M)`. Villain's unmatched excess is returned.

Example: pot 20 BB, you bet 10 BB, villain shoves to 75 BB and you cover: call 65 into a final pot of 170; threshold about 38%. If you can only contribute 40 BB total, call 30 into 100; threshold 30%. Worked answers also give the available-pot-to-call ratio.

Percentages are rounded to whole percentage points; typed answers within one percentage point of the displayed answer are accepted. BB and SPR use tenths (within 0.1 accepted). Chip amounts use whole chips; cash amounts use pennies. Enter numbers without units. The answer panel shows units and the calculation.

Calling thresholds ignore rake and tournament payout effects (ICM). They are chip maths, not a recommendation to call with a particular hand. Draw questions explicitly ask for the rule of two/four approximation, show the exact hit chance for comparison, and assume clean outs. Two-card estimates only apply when both cards are guaranteed; hitting a draw is not automatically the same as winning equity. A pure bluff assumes zero equity when called and no later betting.

References: [PokerStars pot odds and draw shortcuts](https://www.pokerstars.com/poker/learn/lesson/pot-odds/), [Upswing break-even bluff maths](https://upswingpoker.com/fold-equity/).

## Tests

```sh
npm test
```

Tests cover every generator in both formats at all six steps, all-in/matched-stack accounting, calling versus bluff denominators, authenticated saves and retries, backups, gradual progression and browser recovery/timing.

## Host separately on your droplet

Use a separate Git repository/checkout, data directory and HTTPS subdomain. Choose the domain before configuring Apache; existing sites need no changes.

Set `.env` in the poker checkout:

```dotenv
APP_ORIGIN=https://YOUR-POKER-SUBDOMAIN
```

Then:

```sh
mkdir -p data
sudo chown 1000:1000 data
sudo docker compose up -d --build
sudo docker compose exec -it app npm run password
```

The container exposes only `127.0.0.1:8766`. Point a new Apache HTTPS vhost at that port, using the certificate issued for your chosen domain:

```apache
<VirtualHost *:443>
    ServerName YOUR-POKER-SUBDOMAIN
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/YOUR-CERT-NAME/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/YOUR-CERT-NAME/privkey.pem
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8766/
    ProxyPassReverse / http://127.0.0.1:8766/
</VirtualHost>
```

Use the droplet's existing Certbot workflow, substitute the actual domain/certificate paths, enable the new vhost, run `sudo apache2ctl configtest` and reload Apache only after validation succeeds. No deployment or domain has been configured by creating this project.

## Updates and backups

From the poker checkout on the server:

```sh
sudo docker compose exec -T app node scripts/admin.js backup
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=50 app
```

Confirm the backup succeeds before updating. Copy backups off the droplet; local snapshots alone cannot protect against droplet loss. Normal updates preserve `data/` and `.env`; do not rerun account setup. Refresh open browser tabs after deployment. No Apache restart is needed for application-only updates.

Locally, `npm run backup` creates a consistent SQLite snapshot. To restore, stop the app, retain the original data directory, put the snapshot in a new empty data directory as `poker.sqlite3` (without stale WAL/SHM files), correct ownership if using Docker, then point the app at it and restart. Keep matching source code with your snapshot. Reset the password if you need to invalidate restored sessions.

Commit all source and tests, including `questions.js`; never commit `.env`, `data/` or backups.
