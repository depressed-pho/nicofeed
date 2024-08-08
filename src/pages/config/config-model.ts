import * as Bacon from 'baconjs';
import { ActivityID } from 'niconico/feed';

// Unit: seconds
const defaultPollingInterval = 5 * 60;
const defaultTTL             = 30 * 24 * 60 * 60;
const defaultFetchDelay      = 1;

const keyPollingInterval     = "nicofeed.polling-interval";
const keyTTL                 = "nicofeed.TTL";
const keyFetchDelay          = "nicofeed.fetch-delay";
const keyLastVisibleActivity = "nicofeed.last-visible-activity";

/** Invariant: there is at most one instance of this class.
 */
export class ConfigModel {
    private readonly storage: Storage;

    /** The intervals in seconds between polling updates from the
     * server. When it's null the polling is disabled.
     */
    private readonly pollingIntervalBus: Bacon.Bus<number|null>;
    public  readonly pollingInterval: Bacon.Property<number|null>;

    /** The delay in seconds between fetching feed chunks consecutively
     * from the server.
     */
    private readonly fetchDelayBus: Bacon.Bus<number>;
    public  readonly fetchDelay: Bacon.Property<number>;

    public constructor() {
        this.storage = window.localStorage;

        /* Populate the storage with default values. */
        if (!this.storage.getItem(keyPollingInterval))
            this.storage.setItem(keyPollingInterval, String(defaultPollingInterval));
        if (!this.storage.getItem(keyTTL))
            this.storage.setItem(keyTTL, String(defaultTTL));
        if (!this.storage.getItem(keyFetchDelay))
            this.storage.setItem(keyFetchDelay, String(defaultFetchDelay));

        this.pollingIntervalBus = new Bacon.Bus<number|null>();
        this.pollingInterval    =
            this.pollingIntervalBus
                .toProperty(
                    (() => {
                        const val = this.storage.getItem(keyPollingInterval)!;
                        return val == "null" ? null : Number(val);
                    })());

        this.fetchDelayBus = new Bacon.Bus<number>();
        this.fetchDelay    =
            this.fetchDelayBus
                .toProperty(
                    Number(this.storage.getItem(keyFetchDelay)!));

        /* The feed page and the "Options page" are separate documents so
         * they don't share the same object of this class. Listen to
         * StorageEvent to notice the changes made remotely. */
        window.addEventListener("storage", (ev: StorageEvent) => {
            switch (ev.key) {
                case keyPollingInterval:
                    this.pollingIntervalBus.push(
                        ev.newValue == "null" ? null : Number(ev.newValue));
                    break;

                case keyFetchDelay:
                    this.fetchDelayBus.push(Number(ev.newValue));
                    break;

                case keyTTL:
                case keyLastVisibleActivity:
                    break;

                default:
                    console.info(`Ignoring an unknown storage key: ${ev.key}`);
                    break;
            }
        });
    }

    public setPollingInterval(interval: number|null) {
        this.storage.setItem(keyPollingInterval, String(interval));
        this.pollingIntervalBus.push(interval);
    }

    public getTTL(): number {
        return Number(this.storage.getItem(keyTTL));
    }

    public setTTL(ttl: number) {
        this.storage.setItem(keyTTL, String(ttl));
    }

    public setFetchDelay(delay: number) {
        this.storage.setItem(keyFetchDelay, String(delay));
        this.fetchDelayBus.push(delay);
    }

    /* The ID of the activity which was at least partially visible last
     * time the user scrolled or resized the window. It's null when no
     * activities were shown at all.
     */
    public getLastVisibleActivity(): ActivityID|null {
        return this.storage.getItem(keyLastVisibleActivity);
    }

    public setLastVisibleActivity(id: ActivityID|null): void {
        if (id) {
            this.storage.setItem(keyLastVisibleActivity, id);
        }
        else {
            this.storage.removeItem(keyLastVisibleActivity);
        }
    }

    /* Reset configurations that have a default value to the default.
     */
    public resetToDefault() {
        this.setPollingInterval(defaultPollingInterval);
        this.setFetchDelay(defaultFetchDelay);
    }
}
