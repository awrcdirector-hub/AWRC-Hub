Hub notification subscriptions are stored in `hub-notifications-state.json`.

On Render, attach a persistent disk to the Hub service and mount it at:

`/var/data`

The app will then automatically store Hub member data and phone notification registrations at:

`/var/data/hub-notifications-state.json`

Without a persistent disk, redeploying the Hub can clear phone notification registrations and members may need to enable notifications again.
