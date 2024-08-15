import { type TransactionMode, Dexie } from 'dexie';
import { ActivityID, Activity } from 'niconico/feed';

export class FeedDatabase extends Dexie {
    private readonly feed: Dexie.Table<Activity, ActivityID>;

    public constructor() {
        super("nicofeed.feed");
        this.version(1).stores({
            feed: "id, timestamp"
        });
        this.feed = this.table("feed");
    }

    public async tx<T>(mode: TransactionMode, fn: () => Promise<T>): Promise<T> {
        return await this.transaction(mode, this.feed, fn);
    }

    /** Upsert activities in bulk. This isn't an atomic operation. Use tx() if
     * you want atomicity.
     */
    public async bulkPut(activities: Activity[]): Promise<void> {
        await this.feed.bulkPut(activities);
    }

    /** Try inserting an activity. Return true if it wasn't already there,
     * or false otherwise.
     */
    public async tryInsert(activity: Activity): Promise<boolean> {
        try {
            await this.feed.add(activity);
            return true;
        }
        catch (e) {
            if (e instanceof Dexie.ConstraintError) {
                return false;
            }
            else {
                throw e;
            }
        }
    }

    /** Count the number of activities. */
    public async count(): Promise<number> {
        return await this.feed.count();
    }

    /** Find the newest activity in the database, or undefined if there is
     * none.
     */
    public async newest(): Promise<Activity|undefined> {
        return await this.feed.orderBy("timestamp").last();
    }

    /** Lookup an activity with the given ID in the database, or null if no
     * such activity exists.
     */
    public async lookup(id: ActivityID): Promise<Activity|undefined> {
        const res = await this.feed.get(id);
        return res ? res : undefined;
    }

    /** A variant of lookup() which returns boolean.
     */
    public async exists(id: ActivityID): Promise<boolean> {
        return !!await this.lookup(id);
    }

    /** Iterate on all the activities in the database, sorted by their
     * timestamp in descending order.
     */
    public async each(f: (activity: Activity) => void): Promise<void> {
        await this.feed.orderBy("timestamp").reverse().each(f);
    }

    /** A variant of each() which returns an Array instead of calling
     * a function. Not recommended. */
    public async toArray(): Promise<Activity[]> {
        return await this.feed.orderBy("timestamp").reverse().toArray();
    }

    /** Iterate on activities which are older than the given date, and
     * remove them from the database. The callback function can be omitted.
     */
    public async purge(olderThan: Date, f?: (activity: Activity) => void): Promise<void> {
        const coll = this.feed.where("timestamp").below(olderThan);
        if (f) {
            await this.tx("rw", async () => {
                await coll.each(f);
                await coll.delete();
            });
        }
        else {
            await coll.delete();
        }
    }

    /** Clear the entire database. */
    public async clear(): Promise<void> {
        await this.feed.clear();
    }
}
