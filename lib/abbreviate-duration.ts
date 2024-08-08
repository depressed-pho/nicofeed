/** 302.5445864200931 → "5 min"
 */
export function abbreviateDuration(seconds: number, showMillisec = false): string {
    const elems = new Array<string>();
    if (seconds >= 60 * 60 * 24 * 7) {
        const weeks = Math.floor(seconds / (60 * 60 * 24 * 7));
        seconds -= 60 * 60 * 24 * 7 * weeks;
        elems.push(`${weeks}週間`);
    }
    if (seconds >= 60 * 60 * 24) {
        const days = Math.floor(seconds / (60 * 60 * 24));
        seconds -= 60 * 60 * 24 * days;
        elems.push(`${days}日`);
    }
    if (seconds >= 60 * 60) {
        const hours = Math.floor(seconds / (60 * 60));
        seconds -= 60 * 60 * hours;
        elems.push(`${hours}時間`);
    }
    if (seconds >= 60) {
        const min = Math.floor(seconds / 60);
        seconds -= 60 * min;
        elems.push(`${min}分`);
    }
    if (showMillisec) {
        if (seconds >= 1) {
            const sec = Math.floor(seconds);
            seconds -= sec;
            elems.push(`${sec}秒`);
        }
        const ms = Math.floor(seconds * 1000);
        if (elems.length == 0 || ms > 0) {
            elems.push(`${Math.floor(seconds * 1000)}ミリ秒`);
        }
    }
    else {
        elems.push(`${Math.floor(seconds)}秒`);
    }
    return elems.join(" ");
}
