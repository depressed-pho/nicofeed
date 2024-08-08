import * as Bacon from 'baconjs';
import { DropdownMenu } from 'foundation-sites';
import * as $ from 'jquery';
import { parseHTML } from 'niconico/parse-html';
import { ActivityID, Activity, ContentType, renderContentType } from 'niconico/feed';

const enum Visibility {
    AboveViewport,
    Visible,
    BelowViewport
}

/* Invariant: there is at most one instance of this class throughout the
 * lifetime of the feed page.
 */
export class FeedView {
    /** Click events from the "Check for updates" button.
     */
    public readonly updateRequested: Bacon.EventStream<null>;

    /** Click events from menu items.
     */
    public readonly refreshRequested: Bacon.EventStream<null>;
    public readonly editFilterSetRequested: Bacon.EventStream<null>;
    public readonly editPrefsRequested: Bacon.EventStream<null>;
    private readonly filterCreationRequestedBus: Bacon.Bus<Activity>;
    public get filterCreationRequested(): Bacon.EventStream<Activity> {
        return this.filterCreationRequestedBus;
    }

    /** The number of pixels that the content of div.nicofeed-feed is
     * scrolled vertically or the window is resized.
     */
    public readonly feedScrolled: Bacon.EventStream<number>;

    /** The ID of the last visible activity in the viewport. Updated when
     * the viewport is resized or scrolled, but not when an activity is
     * inserted or removed.
     *
     * THINKME: This is also updated (to null) when the feed is cleared,
     * because that unintentionally triggers the DOM "scroll" event. I
     * can't think of a good way to get rid of that. */
    public readonly lastVisibleActivityChanged: Bacon.EventStream<ActivityID|null>;

    private readonly btnUpdate: HTMLButtonElement;
    private readonly progLoading: HTMLProgressElement;
    private readonly tmplActivity: HTMLTemplateElement;
    private readonly divFeed: HTMLDivElement;
    private readonly divActivities: HTMLDivElement;
    private readonly divEndOfFeed: HTMLDivElement;
    private activityInsertionPoint?: Element;

    public constructor(ctx = document) {
        const topBar          = ctx.querySelector<HTMLDivElement>("div.top-bar")!;
        this.btnUpdate        = ctx.querySelector<HTMLButtonElement>("button[data-for='check-for-updates']")!;
        this.updateRequested  = Bacon.fromEvent(this.btnUpdate, "click").map(Bacon.constant(null));
        const menuCtrl        = topBar.querySelector<HTMLElement>(".menu[data-for='control']")!;
        const miEditFilterSet = menuCtrl.querySelector<HTMLAnchorElement>("a[data-for='edit-filter-set']")!;
        this.editFilterSetRequested = Bacon.fromEvent(miEditFilterSet, "click").map(Bacon.constant(null));
        const miEditPrefs     = menuCtrl.querySelector<HTMLAnchorElement>("a[data-for='edit-preferences']")!;
        this.editPrefsRequested = Bacon.fromEvent(miEditPrefs, "click").map(Bacon.constant(null));
        const miRefresh       = menuCtrl.querySelector<HTMLAnchorElement>("a[data-for='refresh']")!;
        this.refreshRequested = Bacon.fromEvent(miRefresh, "click").map(Bacon.constant(null));

        this.filterCreationRequestedBus = new Bacon.Bus<Activity>();

        this.progLoading      = ctx.querySelector<HTMLProgressElement>("progress.nicofeed-loading-progress")!;
        this.tmplActivity     = ctx.querySelector<HTMLTemplateElement>("template[data-for='activity']")!;
        this.divFeed          = ctx.querySelector<HTMLDivElement>("div.nicofeed-feed")!;
        this.divActivities    = ctx.querySelector<HTMLDivElement>("div.nicofeed-activities")!;
        this.divEndOfFeed     = ctx.querySelector<HTMLDivElement>("div.nicofeed-end-of-feed")!;

        this.feedScrolled =
            Bacon.mergeAll([
                Bacon.fromEvent(window, "resize"),
                Bacon.fromEvent(this.divFeed, "scroll")
            ]).map(() => {
                return this.divFeed.scrollTop;
            }).skipDuplicates();

        this.lastVisibleActivityChanged =
            this.feedScrolled
                .throttle(200)
                .map(() => {
                    return this.findLastVisibleActivity();
                })
                .skipDuplicates();
    }

    public resetInsertionPoint(): void {
        delete this.activityInsertionPoint;
    }

    public insertActivity(activity: Activity) {
        /* Inserting an element at somewhere not the bottom of the page has
         * an unwanted consequence: contents that the user is currently
         * looking at may suddenly move without their intention, leading to
         * misclicks that are extremely frustrating. To prevent that from
         * happening, we save the total height of hidden areas before the
         * insertion, and correct the scroll position afterwards. */
        const curScrollPos     = this.divFeed.scrollTop;
        const oldHiddenHeight  = this.divFeed.scrollHeight - this.divFeed.clientHeight;
        let   adjustmentNeeded = false;

        const frag = this.renderActivity(activity);
        if (this.activityInsertionPoint) {
            if (this.activityInsertionPoint.nextElementSibling) {
                // It's not the bottom.
                adjustmentNeeded = true;
            }
            this.activityInsertionPoint.after(frag);
            this.activityInsertionPoint = this.activityInsertionPoint.nextElementSibling!;
        }
        else {
            adjustmentNeeded = true; // It's always the bottom.
            this.divActivities.prepend(frag);
            this.activityInsertionPoint = this.divActivities.firstElementChild!;
        }

        if (adjustmentNeeded) {
            const newHiddenHeight = this.divFeed.scrollHeight - this.divFeed.clientHeight;
            this.divFeed.scrollTop = curScrollPos + (newHiddenHeight - oldHiddenHeight);
        }
    }

    private renderActivity(activity: Activity): DocumentFragment {
        const frag = this.tmplActivity.content.cloneNode(true) as DocumentFragment;

        // Populate the contents of the activity.
        console.assert(frag.children.length === 1, frag);
        const toplevel = frag.firstElementChild! as HTMLElement;
        toplevel.id         = `nicofeed.activity.${activity.id}`;
        toplevel.dataset.id = activity.id;
        toplevel.classList.add(`nicofeed-activity-${activity.kind}`);

        if (activity.actor.type === "user") {
            const aUser = frag.querySelector<HTMLAnchorElement>("a.nicofeed-user-anchor")!
            aUser.href = activity.actor.url;

            const imgUser = frag.querySelector<HTMLImageElement>("img.nicofeed-user-icon")!;
            imgUser.src = activity.actor.iconUrl;

            const spanUser = frag.querySelector<HTMLSpanElement>("span.nicofeed-user-name")!;
            spanUser.textContent = activity.actor.name;
        }
        else {
            const divUser = frag.querySelector<HTMLDivElement>("a.nicofeed-user")!
            divUser.classList.add("hide");
        }

        const miCreateFilter = frag.querySelector<HTMLAnchorElement>("a[data-for='create-filter']")!;
        miCreateFilter.addEventListener("click", () => {
            this.filterCreationRequestedBus.push(activity);
        });

        const divMessage = frag.querySelector<HTMLDivElement>("div.nicofeed-activity-message")!;
        divMessage.appendChild(parseHTML(activity.message));

        const divTimestamp = frag.querySelector<HTMLDivElement>("div.nicofeed-activity-timestamp")!;
        divTimestamp.textContent = activity.timestamp.toLocaleString();

        if (activity.content) {
            for (const aContent of frag.querySelectorAll<HTMLAnchorElement>("a.nicofeed-content-anchor")) {
                aContent.href = activity.content.url;
            }

            const imgContentThumb = frag.querySelector<HTMLImageElement>("img.nicofeed-content-thumb")!;
            imgContentThumb.src = activity.thumbnailUrl;

            const spanContentType = frag.querySelector<HTMLSpanElement>("span.nicofeed-content-type")!;
            spanContentType.textContent = renderContentType(activity.content.type);

            const spanContentTitle = frag.querySelector<HTMLSpanElement>("span.nicofeed-content-title")!;
            spanContentTitle.textContent = activity.content.title;
        }
        else {
            const divContent = frag.querySelector<HTMLDivElement>("div.nicofeed-content")!;
            divContent.classList.add("hide");
        }

        // Setup a Foundation dropdown menu for muting.
        const menuMuting = frag.querySelector<HTMLElement>(".menu.nicofeed-muting")!;
        new DropdownMenu($(menuMuting));

        return frag;
    }

    private findActivity(id: ActivityID): Element|null {
        return this.divFeed.ownerDocument.getElementById(`nicofeed.activity.${id}`);
    }

    public deleteActivity(id: ActivityID): void {
        const el = this.findActivity(id);
        if (el) {
            console.info("Activity expired:", id);
            el.parentNode!.removeChild(el);
        }
    }

    public clearFeed() {
        this.divActivities.replaceChildren();
        delete this.activityInsertionPoint;
        this.divEndOfFeed.classList.add("hide");
    }

    public showEndOfFeed(): void {
        this.divEndOfFeed.classList.remove("hide");
    }

    public updateProgress(progress: number) {
        this.progLoading.value = progress;
        if (progress < 1) {
            if (!this.progLoading.classList.contains("nicofeed-fast-fade-in")) {
                this.progLoading.classList.add("nicofeed-fast-fade-in");
                this.progLoading.classList.remove("nicofeed-fast-fade-out");
                // The progress bar is initially hidden without transition.
                this.progLoading.classList.remove("nicofeed-transparent");
            }
        }
        else {
            if (!this.progLoading.classList.contains("nicofeed-fast-fade-out")) {
                this.progLoading.classList.add("nicofeed-fast-fade-out");
                this.progLoading.classList.remove("nicofeed-fast-fade-in");
            }
        }
    }

    /** Find the ID of the activity which is fully visible now, or null if
     * no activities are shown at all. This method is very frequently
     * called so it needs to be fast.
     */
    private findLastVisibleActivity(): ActivityID|null {
        /* Perform a binary search on the list of activity elements. Maybe
         * this isn't fast enough, but I can't think of a better way. */
        const elems = this.divActivities.children;

        if (elems.length == 0) {
            return null;
        }
        else {
            let rangeBegin = 0;              // inclusive
            let rangeEnd   = elems.length-1; // inclusive
            let foundElem: Element|null = null;
            loop: while (rangeBegin <= rangeEnd) {
                const needle = Math.floor((rangeBegin + rangeEnd) / 2);
                const elem   = elems[needle];
                const visibi = this.visibilityOfActivityElement(elem);
                switch (visibi) {
                    case Visibility.AboveViewport:
                        rangeBegin = needle + 1;
                        continue;

                    case Visibility.BelowViewport:
                        rangeEnd = needle - 1;
                        continue;

                    case Visibility.Visible:
                        foundElem = elem;
                        break loop;

                    default:
                        throw new Error("Unreachable!");
                }
            }
            if (foundElem) {
                /* So, we found a visible element but we still don't know
                 * if it's the last one (probably not). We just search for
                 * the last one linearly because there can't be hundreds of
                 * visible elements in the viewport. */
                let lastElem = foundElem;
                while (true) {
                    const nextElem = lastElem.nextElementSibling;
                    if (nextElem &&
                        this.visibilityOfActivityElement(nextElem) === Visibility.Visible) {
                        lastElem = nextElem;
                        continue;
                    }
                    else {
                        break;
                    }
                }
                return (lastElem as HTMLElement).dataset.id!;
            }
            else {
                /* There are some activities but none are visible. This
                 * can only happen when the window is extremely narrow. */
                return null;
            }
        }
    }

    /** Check if a given element is fully visible. This is a faster and
     * simplified version of the solution shown in
     * https://stackoverflow.com/a/21627295 but exploits our specific DOM
     * structure.
     */
    private visibilityOfActivityElement(el: Element): Visibility {
        const elRect = el.getBoundingClientRect();
        const vpRect = this.divFeed.getBoundingClientRect();

        if (elRect.top < vpRect.top) {
            /* The element is above the visible part of its scrollable
             * ancestor. */
            return Visibility.AboveViewport;
        }
        else if (elRect.bottom > vpRect.bottom) {
            /* The element is below the visible part of its scrollable
             * ancestor. */
            return Visibility.BelowViewport;
        }
        else {
            return Visibility.Visible;
        }
    }

    /** Scroll the feed so that the activity with the given ID is
     * visible. Do nothing if no such activity exists.
     */
    public scrollTo(id: ActivityID): void {
        const el = this.findActivity(id);
        if (el) {
            el.scrollIntoView();
        }
    }

    public setUpdatingAllowed(isAllowed: boolean): void {
        if (isAllowed) {
            this.btnUpdate.classList.remove("disabled");
        }
        else {
            this.btnUpdate.classList.add("disabled");
        }
    }
}
