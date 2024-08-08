module.exports = {
    manifest_version: 3,
    name: "Nicofeed",
    icons: {
        "48": "assets/icon.svg",
        "96": "assets/icon.svg"
    },
    background: {
        scripts: ["background.js"]
    },
    action: {
        "default_icon": "assets/icon.svg",
        "default_title": "Nicofeed"
    },
    options_ui: {
        "page": "assets/pages/config/config.html"
    },
    permissions: [
        "tabs",
        "unlimitedStorage",
    ],
    // These has to be synchronised with src/background.ts.
    host_permissions: [
        // To access the feed API.
        "https://api.feed.nicovideo.jp/*"
    ],
    browser_specific_settings: {
        gecko: {
            id: "nicofeed@cielonegro.org"
        }
    }
};
