# Zentux Discord Bot

Discord bot for purchases and Zentux license access.

## Commands

- `/canjear codigo`: links an active license to one Discord account and grants the buyer role.
- `/info`: privately shows the linked key, status, expiration date, and remaining time.

The bot synchronizes linked licenses every few minutes. It grants the buyer role to active licenses and removes it from expired, inactive, or deleted licenses.

## Configuration

Copy `.env.example` to `.env` and configure every required value. The value of `DISCORD_LICENSE_SECRET` must be identical in this bot and the Render license server.

The bot needs the `Manage Roles` permission, and its highest Discord role must be above the buyer role.

## Commands

```powershell
npm install
npm run deploy-commands
npm start
```

## Manual benefit roles

Content Creator is assigned and removed by administrators in Discord. The bot never adds this role from a stored license, including during periodic synchronization, `/info`, or `/canjear`. Removing the role immediately deactivates the Content Creator benefit; startup and periodic checks recover missed events using a fresh member fetch. Temporary Discord API failures do not count as role removal. Assigning the role again allows the benefit to be reactivated.

The Signed Players program is retired. `/signed-player` and `/admin-signed-player` are no longer registered, role changes no longer create Signed Player licenses, and old Signed Player benefits are deactivated without deleting purchase history. Paid Buyer, Reward Access, and Giveaway Access still synchronize from their licenses.
