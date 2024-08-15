import 'foundation-sites';
import * as $ from 'jquery';
import './feed.scss';
import { FilterRuleSet } from 'niconico/feed/filter';
import { ConfigModel } from '../config/config-model';
import { ResetInsertionPointEvent, InsertActivityEvent, DeleteActivityEvent,
         ShowEndOfFeedEvent, ClearFeedEvent, UpdateProgressEvent,
         SetUpdatingAllowed, FeedModel
       } from './feed-model';
import { FeedView } from './feed-view';
import { createFilter } from '../create-filter/create-filter';
import { editFilterSet } from '../edit-filter-set/edit-filter-set';
import { signIn } from '../sign-in/sign-in';

/* This is the entry point of /assets/pages/feed/feed.html and is a
 * controller in the MVC sense.
 */

window.addEventListener("DOMContentLoaded", async () => {
    $(document).foundation();

    const configModel = new ConfigModel();
    const filterRules = new FilterRuleSet();
    const feedModel   = new FeedModel(configModel, filterRules, signIn);
    const feedView    = new FeedView();

    /* Setup handlers for UI events from FeedView. */
    feedView.updateRequested.onValue(() => feedModel.checkForUpdates());
    feedView.editPrefsRequested.onValue(async () => await browser.runtime.openOptionsPage());
    feedView.refreshRequested.onValue(async () => await feedModel.refresh());
    feedView.filterCreationRequested.onValue(async activity => {
        const ruleDesc = await createFilter(activity);
        if (ruleDesc) {
            const rule = await filterRules.add(ruleDesc);
            console.debug("A new filtering rule has been added:", rule);
            await feedModel.refresh(false);
        }
    });
    feedView.editFilterSetRequested.onValue(async () => {
        const isUpdated = await editFilterSet(filterRules);
        if (isUpdated) {
            console.debug("The set of filtering rules has been updated. Reloading the feed...");
            await feedModel.refresh(false);
        }
    });

    let shouldScroll = true;

    /* It is our responsible to interpret feed events coming from the
     * model. */
    feedModel.feedEvents.onValue(ev => {
        if (ev instanceof ResetInsertionPointEvent) {
            feedView.resetInsertionPoint();
        }
        else if (ev instanceof InsertActivityEvent) {
            feedView.insertActivity(ev.activity);

            // Auto-scrolling should happen after the feed is cleared until
            // the first activity whose timestamp <= lastVis is inserted.
            // When lastVis is null it means this is the first time we got
            // the feed. In that case auto-scrolling should never happen.
            if (shouldScroll) {
                const lastVis = feedModel.getLastVisibleTimestamp();
                if (lastVis) {
                    if (ev.activity.timestamp >= lastVis) {
                        feedView.scrollTo(ev.activity.id);
                    }
                    if (ev.activity.timestamp <= lastVis) {
                        shouldScroll = false;
                    }
                }
                else {
                    shouldScroll = false;
                }
            }
        }
        else if (ev instanceof DeleteActivityEvent) {
            feedView.deleteActivity(ev.id);
        }
        else if (ev instanceof ClearFeedEvent) {
            // shouldScroll must be set before clearFeed() is called, to
            // prevent an unintended scroll event from making it through.
            shouldScroll = true;
            feedView.clearFeed();
        }
        else if (ev instanceof ShowEndOfFeedEvent) {
            feedView.showEndOfFeed();
        }
        else if (ev instanceof UpdateProgressEvent) {
            feedView.updateProgress(ev.progress);
        }
        else if (ev instanceof SetUpdatingAllowed) {
            feedView.setUpdatingAllowed(ev.isAllowed);
        }
        else {
            throw new Error("Unknown type of FeedEvent: " + ev.constructor.name);
        }
    });

    // The change in the cursor position should only be recorded when
    // auto-scrolling is disabled.
    feedView.lastVisibleTimestampChanged.onValue(timestamp => {
        if (!shouldScroll) {
            feedModel.setLastVisibleTimestamp(timestamp);
        }
    });
});
