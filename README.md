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
