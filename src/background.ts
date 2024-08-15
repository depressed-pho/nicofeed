/* Handle the click event on the navigation bar icon. Open the feed
 * page in a new tab if it's not already open, otherwise activate an
 * existing one.
 */
async function navbarIconClicked() {
    const perms = {
        origins: [
            "https://api.feed.nicovideo.jp/*",
        ]
    };
    if (!await browser.permissions.request(perms)) {
        return;
    }

    const URL    = browser.runtime.getURL("/assets/pages/feed/feed.html");
    const result = await browser.tabs.query({
        currentWindow: true,
        url: URL
    });
    if (result.length > 0 && result[0]!.id != null) {
        await browser.tabs.update(result[0]!.id, {active: true});
    }
    else {
        await browser.tabs.create({
            url: URL
        });
    }
}
browser.runtime.onInstalled.addListener(() => {
    browser.action.onClicked.addListener(navbarIconClicked);
});
