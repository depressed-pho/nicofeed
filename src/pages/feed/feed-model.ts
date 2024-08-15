import * as Bacon from 'baconjs';
import { UnauthorizedError } from 'niconico/errors';
import { CursorDatabase } from 'niconico/cursor-db';
import { ActivityID, FeedChunk, Activity, getFeedChunk } from 'niconico/feed';
import { FeedDatabase } from 'niconico/feed/db';
import { FilterAction, FilterRuleSet } from 'niconico/feed/filter';
import { ConfigModel } from '../config/config-model';

const DEBUG_FETCH_ONLY_THE_FIRST_CHUNK = true;

export class FeedEvent {}

/** Move the insertion point to the top of the feed.
 */
export class ResetInsertionPointEvent extends FeedEvent {
    public constructor() { super() }
}

/** Insert an activity at the current insertion point.
 */
export class InsertActivityEvent extends FeedEvent {
    public constructor(public readonly activity: Activity) { super() }
}

/** Delete an activity with the given ID.
 */
export class DeleteActivityEvent extends FeedEvent {
    public constructor(public readonly id: ActivityID) { super() }
}

/** Show the "end of feed" marker.
 */
export class ShowEndOfFeedEvent extends FeedEvent {
    public constructor() { super() }
}

/** Clear the feed and hide the "end of feed" marker.
 */
export class ClearFeedEvent extends FeedEvent {
    public constructor() { super() }
}

/** Show the progress bar with given progress [0, 1), or hide when 1.
 */
export class UpdateProgressEvent extends FeedEvent {
    public constructor(public readonly progress: number) { super() }
}

/** Enable or disable the update button.
*/
export class SetUpdatingAllowed extends FeedEvent {
    public constructor(public readonly isAllowed: boolean) { super() }
}

export class FeedModel {
    private readonly config: ConfigModel;
    private readonly filterRules: FilterRuleSet;
    private readonly feedDB: FeedDatabase;
    private readonly cursorDB: CursorDatabase;

    /** Events telling the FeedView to what to do about the feed.
     */
    private readonly feedEventBus: Bacon.Bus<FeedEvent>;
    public readonly feedEvents: Bacon.EventStream<FeedEvent>;

    /** Events telling the model to trigger checking for updates.
     */
    private readonly updateRequested: Bacon.Bus<null>;

    /** An async function to authenticate the user.
     */
    private authenticate: () => Promise<void>;

    /** A function to unplug the currently active activity source. Called
     * on refresh.
     */
    private unplugActivitySource: (() => void)|undefined;

    public constructor(config: ConfigModel,
                       filterRules: FilterRuleSet,
                       authenticate: () => Promise<void>) {
        this.config          = config;
        this.filterRules     = filterRules;
        this.authenticate    = authenticate;
        this.feedDB          = new FeedDatabase();
        this.cursorDB        = new CursorDatabase();
        this.feedEventBus    = new Bacon.Bus<FeedEvent>();
        this.feedEvents      = this.feedEventBus.toEventStream();
        this.updateRequested = new Bacon.Bus<null>();

        this.unplugActivitySource =
            this.feedEventBus.plug(this.spawnActivitySource());
    }

    private spawnActivitySource(): Bacon.EventStream<FeedEvent> {
        /* An activity source is a concatenation of infinitely many
         * streams:
         *
         * 0. The entire database.
         *
         * 1. The feed from the server from the beginning up until the
         *    first activity that is already in the database. There will be
         *    a silence between each chunk requests.
         *
         * 2. Silence for the polling interval, then repeat from 1.
         */
        return Bacon.repeat(i => {
            switch (i) {
                case 0:
                    return this.readDatabase();

                case 1:
                    return this.fetchFromServer();

                default:
                    // Construct an EventStream which emits null after some
                    // interval. Downstream can stop waiting on its first
                    // event. This is so that we can respond to interval
                    // changes even while in the interval.
                    const intervalStartedAt = Date.now();
                    const interval =
                        Bacon.mergeAll(
                            this.config.pollingInterval,
                            this.updateRequested.map(() => 0)
                        ).flatMap(delay => {
                            if (delay == null) {
                                return Bacon.never();
                            }
                            else {
                                const delayedSoFar = Date.now() - intervalStartedAt;
                                const remaining    = Math.max(0, delay * 1000 - delayedSoFar);
                                console.debug(
                                    "We are going to poll the server for updates after %f seconds.", remaining / 1000);
                                return Bacon.later(remaining, null);
                            }
                        });
                    return interval.first().flatMap(() => this.fetchFromServer());
            }
        });
    }

    private standardExpirationDate(): Date {
        const d = new Date();
        d.setMonth(d.getMonth()-1, d.getDate());
        // The beginning of the day. The upstream uses this for
        // whatever reason. THINKME: Does it still do so?
        d.setHours(0, 0, 0, 0);
        return d;
    }

    /** Get the expiration date of activities based on the current time. It
     * is either 1 month ago from now, or some configured time ago from the
     * last visible entry, whichever is earlier.
     */
    private async expirationDate(): Promise<Date|null> {
        const std    = this.standardExpirationDate();
        const cursor = await this.cursorDB.cutOff(this.config.getTTL());

        if (cursor)
            return std.getTime() < cursor.getTime() ? std : cursor;
        else
            return null;
    }

    /** Create a stream of FeedEvent reading all the activities in the
     * database.
     */
    private readDatabase(): Bacon.EventStream<FeedEvent> {
        return Bacon.fromBinder(sink => {
            let   abort   = false;
            const promise = (async () => {
                sink(new Bacon.Next(new SetUpdatingAllowed(false)));
                sink(new Bacon.Next(new UpdateProgressEvent(0)));
                /* Purge old activities before reading anything. We don't
                 * have to mess with DeleteEntryEvent because no entries
                 * are displayed at this point. */
                const expireAt = await this.expirationDate();
                if (expireAt) {
                    await this.feedDB.tx("rw", async () => {
                        await this.feedDB.purge(expireAt);
                    });
                }
                /* Note that we can't do it in a big transaction
                 * because we have to touch two databases at the same
                 * time. */
                const activities = await this.feedDB.toArray();
                const total      = activities.length;
                let   count      = 0;
                let   nFiltered  = 0;
                console.info("Loading %d activities from the database...", total);
                for (const activity of activities) {
                    if (abort) {
                        console.debug("Got an abort request. Exiting...");
                        break;
                    }
                    count++;
                    if (await this.filterRules.apply(activity) === FilterAction.Show) {
                        sink(new Bacon.Next(new InsertActivityEvent(activity)));
                    }
                    else {
                        nFiltered++;
                    }
                    sink(new Bacon.Next(new UpdateProgressEvent(count / total)));
                }
                if (nFiltered > 0) {
                    console.log("Filtered out %d activities in the database.", nFiltered);
                }
                if (total > 0) {
                    /* We are going to fetch the feed from the server, but
                     * since the database wasn't empty, there won't be any
                     * activities older than the ones in the database. */
                    sink(new Bacon.Next(new ShowEndOfFeedEvent()));
                }
                sink(new Bacon.Next(new UpdateProgressEvent(1)));
            })();
            promise
                .catch(e => {
                    console.error(e);
                    sink(new Bacon.Error(e));
                })
                .then(() => {
                    sink(new Bacon.Next(new ResetInsertionPointEvent()));
                    sink(new Bacon.Next(new UpdateProgressEvent(1)));
                    sink(new Bacon.End());
                });
            return () => {
                abort = true;
            }
        });
    }

    /** Create a stream of FeedEvent fetching from the server from the
     * beginning up until the first activity that is already in the
     * database. There will be a silence between each chunk requests.
     */
    private fetchFromServer(): Bacon.EventStream<FeedEvent> {
        return Bacon.fromBinder(sink => {
            let   abort   = false;
            const promise = (async () => {
                sink(new Bacon.Next(new SetUpdatingAllowed(false)));
                sink(new Bacon.Next(new UpdateProgressEvent(0)));

                /* Purge old activities before posting requests. */
                const expireAt = await this.expirationDate();
                if (expireAt) {
                    this.feedDB.tx("rw", async () => {
                        await this.feedDB.purge(expireAt, activity => {
                            sink(new Bacon.Next(new DeleteActivityEvent(activity.id)));
                        });
                    });
                }

                /* Some work for displaying the progress bar. This doesn't
                 * need to be in a transaction because it's only
                 * informational. */
                const started    : number = Date.now();
                const expectedEnd: number = await (async () => {
                    const newest = await this.feedDB.newest();
                    if (newest) {
                        console.debug(
                            "The timestamp of the newest activity in the database is ", newest.timestamp);
                        return newest.timestamp.getTime();
                    }
                    else {
                        const d = this.standardExpirationDate();
                        console.debug("The timestamp of the last available activity is expected to be", d);
                        return d.getTime();
                    }
                })();

                /* Fetching the entire feed takes very long. It can be very
                 * large, but we still have to store them to the database
                 * all at once nevertheless because otherwise we may end up
                 * in an inconsistent state. So we buffer all the
                 * activities and store them afterwards. */
                const newActivities = new Array<Activity>();
                let nextCursor: ActivityID|undefined;
                let nFiltered = 0;

                loop: while (true) {
                    if (abort) {
                        console.debug("Got an abort request. Exiting...");
                        break;
                    }

                    console.debug(
                        "Requesting a chunk of feed " +
                            (nextCursor ? `starting from ${nextCursor}.` : "from the beginning."));
                    const chunk = await this.fetchChunkFromServer(nextCursor);
                    console.debug(
                        "Got a chunk containing %i activities.", chunk.activities.length);

                    for (const activity of chunk.activities) {
                        if (await this.feedDB.exists(activity.id)) {
                            console.debug(
                                "Found an activity which was already in our database: %s", activity.id);
                            console.debug(
                                "We got %d new activities from the server.", newActivities.length);
                            break loop;
                        }
                        if (await this.filterRules.apply(activity) === FilterAction.Show) {
                            sink(new Bacon.Next(new InsertActivityEvent(activity)));
                        }
                        else {
                            nFiltered++;
                        }
                        sink(new Bacon.Next(new UpdateProgressEvent(
                            (started - activity.timestamp.getTime()) / (started - expectedEnd))));
                        newActivities.push(activity);
                    }

                    if (chunk.nextCursor) {
                        nextCursor = chunk.nextCursor;

                        // Construct an EventStream which emits null after
                        // some interval. Downstream can stop waiting on
                        // its first event. This is so that we can respond
                        // to interval changes even while in the interval.
                        const intervalStartedAt = Date.now();
                        const interval =
                            this.config.fetchDelay
                                .flatMap(delay => {
                                    const delayedSoFar = Date.now() - intervalStartedAt;
                                    const remaining    = Math.max(0, delay * 1000 - delayedSoFar);
                                    console.debug(
                                        "We are going to fetch the next chunk after %f seconds.", remaining / 1000);
                                    return Bacon.later(remaining, null);
                                });
                        await interval.firstToPromise();
                        if (DEBUG_FETCH_ONLY_THE_FIRST_CHUNK) {
                            break loop;
                        }
                        else {
                            continue loop;
                        }
                    }
                    else {
                        console.debug("It was the last feed chunk available.");
                        console.debug("We got %d activities from the server.", newActivities.length);
                        sink(new Bacon.Next(new ShowEndOfFeedEvent()));
                        break loop;
                    }
                }
                if (nFiltered > 0) {
                    console.log("Filtered out %d activities from the server.", nFiltered);
                }
                await this.feedDB.tx("rw", async () => {
                    await this.feedDB.bulkPut(newActivities);
                });
            })();
            promise
                .catch(e => {
                    console.error(e);
                    sink(new Bacon.Error(e));
                })
                .then(() => {
                    sink(new Bacon.Next(new ResetInsertionPointEvent()));
                    sink(new Bacon.Next(new UpdateProgressEvent(1)));
                    sink(new Bacon.Next(new SetUpdatingAllowed(true)));
                    sink(new Bacon.End());
                });
            return () => {
                abort = true;
            };
        });
    }

    /** Create a Promise resolving to a fetched FeedChunk with optionally
     * skipping till a given ID. Invoke the authentication callback when
     * necessary.
     */
    private async fetchChunkFromServer(nextCursor?: ActivityID): Promise<FeedChunk> {
        while (true) {
            try {
                return await getFeedChunk(nextCursor);
            }
            catch (e) {
                if (e instanceof UnauthorizedError) {
                    await this.authenticate();
                    continue;
                }
                else {
                    // FIXME
                    throw e;
                }
            }
        }
    }

    /** Check for updates immediately, without waiting for the automatic
     * update timer.
     */
    public checkForUpdates(): void {
        this.updateRequested.push(null);
    }

    /** Discard all the activities in the database and reload them from the
     * server. The method can optionally skip clearing the database which
     * is used when the set of filtering rules is updated.
     */
    public async refresh(clearDatabase = true): Promise<void> {
        /* Unplug the activity source so that no feed events will be sent
         * through the bus. */
        if (this.unplugActivitySource) {
            this.unplugActivitySource();
            this.unplugActivitySource = undefined;
        }

        if (clearDatabase) {
            // Clear the database.
            await this.feedDB.clear();
        }

        // Tell the feed view to clear the entire feed.
        this.feedEventBus.push(new ClearFeedEvent());

        // Reload the feed from the server (and the database if we didn't
        // clear it).
        this.unplugActivitySource =
            this.feedEventBus.plug(this.spawnActivitySource());
    }

    public getLastVisibleTimestamp(): Date|undefined {
        return this.config.getLastVisibleTimestamp();
    }

    public setLastVisibleTimestamp(timestamp: Date|undefined) {
        this.config.setLastVisibleTimestamp(timestamp);
        if (timestamp)
            this.cursorDB.put(timestamp);
    }
}
