# Project Title

An extension that shows how to open and communicate with the panel through messages and menus.
The panel is based on Vue3.x.

## Development Environment

Node.js

## Install

```bash
# Install dependent modules
npm install
# build
npm run build
```

## Usage

After enabling the extension, click `Panel -> cc-assets-compress -> Media Asset Browser` in the main menu bar to open the extension.

The extension can browse, preview, inspect, compress, and restore PNG, JPG, and MP3 assets in the current Cocos Creator project.

After clicking `Send Message to Panel`, a message `send-to-panel` will be sent to the extension as defined by `contributions.menu` in `package.json`. When the extension receives the `send-to-panel` message, it will cause the `default` panel to call the `hello` method as defined by `contributions.messages` in `package.json`.
