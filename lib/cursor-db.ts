import { type EntityTable, Dexie } from 'dexie';

/* We want to purge old activities that the user wouldn't want to see
 * again, otherwise we would fill up the storage. We also don't want to
 * purge ones that were only momentarily scrolled out, because that is
 * likely to be an accident. So what we need to do is to purge activities
 * that have been scrolled out for at least N days, where N is some
 * user-configured number.
 *
 * The most obvious way to achieve this is to record the last visible time
 * for each activity, but that would be way too inefficient. (Remember, it
 * needs to happen every time the user scrolls the window.) Instead we
 * record the scrolling position of the window (actually the timestamp of
 * the last visible activity) continually as a time series, and use that
 * data to determine the range of activities to be purged.
 *
 * Original time series:
 *
 *                xx
 *              xx
 *    xx      xx
 *   x  x    x
 *  x    x  x
 *  x     xx
 * x
 * x
 * x
 *
 * x axis: timestamp of scrolling events
 * y axis: scrolling position
 *
 *
 * However, the time series needs to be somehow turned into a
 * monotonically-increasing curve.
 *
 * Squashing:
 *
 *    xx
 *   x  x  <- This data point goes backwards (it is lower than the
 *  x         maximum) so it needs to be squashed.
 *  x
 * x
 * x
 * x
 *
 *   x     <- Like this. 3 data points are discarded.
 *  x
 *  x         Algorithm: For each data point preceding the current one, if
 * x          its position >= that of the current one, then discard it.
 * x          Otherwise exit the loop.
 * x
 *
 *   x
 *  x x    <- The next data point also goes backwards.
 *  x
 * x
 * x
 * x
 *
 *  x      <- So discard 2 more data points.
 *  x
 * x
 * x
 * x
 *
 *         xx
 *       xx
 *     xx
 *    x       The final curve looks like this.
 *   x
 *  x
 * x
 * x
 * x
 *
 * Purging:
 *
 *      |  xx
 *      |xx
 *     xx
 *    x |     Locate a data point which has the largest timestamp that is
 *   x  |     at least N days earlier than the current date. Then use its
 *  x   |     scrolling position as the cutoff point and purge any
 * x    |     activities older than (or equal to) that.
 * x    |
 * x    |
 *
 *    xx
 *  xx        We can also purge data points that are older than the cutoff
 * x          point.
 */

interface TimedCursor {
    cursorTime: Date,
    activityTime: Date,
}

export class CursorDatabase extends Dexie {
    private readonly timeSeries!: EntityTable<TimedCursor, "cursorTime">;

    constructor() {
        super("nicofeed.cursor");
        this.version(1).stores({
            timeSeries: "cursorTime",
        });
    }

    /** Insert a data point. If for whatever reason there is already a data
     * point with the same time stamp, then the old one will be overwritten.
     */
    public async put(activityTime: Date, cursorTime = new Date()): Promise<void> {
        // But do not store data redundantly.
        return await this.transaction("rw?", this.timeSeries, async () => {
            const last = await this.timeSeries.toCollection().last();
            if (!last || last.activityTime.getTime() != activityTime.getTime()) {
                await this.timeSeries.put({
                    cursorTime,
                    activityTime,
                });
            }
        });
    }

    /** Squash data points and find the cut-off point. Also purge data
     * points that we no longer need to retain. The resulting promise may
     * resolve to null: in that case no activities should be purged.
     */
    public async cutOff(TTL: number): Promise<Date|null> {
        return await this.transaction("rw?", this.timeSeries, async () => {
            // Do we need to squash anything? If the data points are
            // already monotonically-increasing, then we don't have to do
            // anything.
            let maxActivityTime: number|null = null;
            let squashedAny = false;
            const dataPoints: TimedCursor[] = [];
            for (const point of await this.timeSeries.toArray()) {
                const currentTime = point.activityTime.getTime();
                if (maxActivityTime != null && currentTime < maxActivityTime) {
                    // Found a non-increasing point.
                    while (dataPoints.length > 0) {
                        const last = dataPoints.at(-1)!;
                        if (last.activityTime.getTime() >= currentTime)
                            dataPoints.pop();
                        else
                            break;
                    }
                    squashedAny = true;
                }
                else {
                    maxActivityTime = currentTime;
                }
                dataPoints.push(point);
            }

            // Locate a cut-off point.
            const expiresAt = new Date().getTime() - TTL * 1000;
            let purgedAny = false;
            let cutOff: Date|null = null;
            for (let i = dataPoints.length - 1; i >= 0; i--) {
                const point = dataPoints[i]!;
                if (point.cursorTime.getTime() < expiresAt) {
                    // Found.
                    cutOff = point.activityTime;
                    if (i > 0) {
                        dataPoints.splice(0, i);
                        purgedAny = true;
                    }
                    break;
                }
            }

            // Replace the table with new data points if we have discarded
            // anything.
            if (squashedAny || purgedAny) {
                await this.timeSeries.clear();
                await this.timeSeries.bulkPut(dataPoints);
            }

            return cutOff;
        });
    }
}
