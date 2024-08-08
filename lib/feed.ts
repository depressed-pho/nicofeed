import { UnauthorizedError } from 'niconico/errors';

export interface FeedChunk {
    activities: [Activity],
    nextCursor?: ActivityID
}

export type ActivityID = string;
// This has to be synched with src/pages/create-filter/create-filter.html
// and src/pages/edit-filter-set/edit-filter-set.html
export type ActivityKind =
    "advertise" | "schedule" | "start" | "get-magic-number" |
    "like" | "list" | "upload" | "unknown";
export interface Activity {
    id: ActivityID,
    kind: ActivityKind,
    /// Human-readable message text of the activity.
    message: string,
    thumbnailUrl: string,
    content?: ActivityContent,
    timestamp: Date,
    actor: Actor,
}

// This has to be synched with renderContentType(),
// src/pages/create-filter/create-filter.html, and
// src/pages/edit-filter-set/edit-filter-set.html
export type ContentType =
    "video" | "stream" | "image" | "comic" | "article" | "model" | "game" | "unknown"
export interface ActivityContent {
    type: ContentType,
    title: string,
    url: string,
}

export type Actor = User | UnknownActor;
export type UserID = string;
export interface User {
    type: "user",
    id: UserID,
    name: string,
    iconUrl: string,
    url: string,
}
export interface UnknownActor {
    type: "unknown",
}

export function renderContentType(type: ContentType): string {
    switch (type) {
        case "video":   return "動画";
        case "stream":  return "放送";
        case "image":   return "静画";
        case "comic":   return "漫画";
        case "article": return "ブログ記事";
        case "model":   return "3D モデル";
        case "game":    return "ゲーム";
        default:
            return "(不明)";
    }
}

export async function getFeedChunk(cursor?: ActivityID): Promise<FeedChunk> {
    const URL = "https://api.feed.nicovideo.jp/v1/activities/followings/all?context=my_timeline"
        + (cursor ? `&cursor=${cursor}` : "");
    const res = await fetch(URL, {
        method: "GET",
        mode: "cors",
        credentials: "include",
        headers: {
            "X-Frontend-Id": "6",
        },
    });
    if (res.ok) {
        const json = await res.json();

        console.assert(json.code === "ok", json);
        console.assert(json.activities instanceof Array, json);
        if (json.nextCursor) {
            console.assert(typeof json.nextCursor === "string", json);
        }
        return {
            activities: json.activities.map(parseActivity),
            ...(json.nextCursor ? {nextCursor: json.nextCursor} : {}),
        };
    }
    else {
        // FIXME
        throw new UnauthorizedError();
    }
}

function parseActivity(json: any): Activity {
    console.assert(typeof json.message      === "object", json);
    console.assert(typeof json.message.text === "string", json.message);
    console.assert(typeof json.thumbnailUrl === "string", json);
    if (json.content) {
        console.assert(typeof json.content === "object", json);
    }
    console.assert(typeof json.id           === "string", json);
    console.assert(typeof json.kind         === "string", json);
    console.assert(typeof json.createdAt    === "string", json);
    console.assert(typeof json.actor        === "object", json);
    return {
        id: json.id,
        kind: parseActivityKind(json.kind),
        message: json.message.text,
        thumbnailUrl: json.thumbnailUrl,
        ...(json.content ? {content: parseActivityContent(json.content)} : {}),
        timestamp: new Date(json.createdAt), // Should be in W3C DTF
        actor: parseActor(json.actor),
    };
}

function parseActivityKind(kind: string): ActivityKind {
    switch (kind) {
        case "nicolive.user.program.onairs":
            return "start";

        case "nicovideo.user.video.kiriban.play":
            return "get-magic-number";

        case "nicoseiga.user.comic.favorite":
        case "nicovideo.user.video.first_like":
            return "like";

        case "nicovideo.user.mylist.add.video":
            return "list";

        case "nicoseiga.user.illust.upload":
        case "nicovideo.user.video.upload":
            return "upload";

        default:
            console.warn("Unknown activity kind:", kind);
            return "unknown";
    }
}

function parseActivityContent(json: any): ActivityContent {
    console.assert(typeof json.type  === "string", json);
    console.assert(typeof json.title === "string", json);
    console.assert(typeof json.url   === "string", json);
    return {
        type: parseContentType(json.type),
        title: json.title,
        url: json.url,
    };
}

function parseContentType(type: string): ContentType {
    switch (type) {
        case "video":
            return "video";

        case "program":
            return "stream";

        case "illust":
            return "image";

        case "comic":
            return "comic";

        default:
            console.warn("Unknown activity content type:", type);
            return "unknown";
    }
}

function parseActor(json: any): Actor {
    console.assert(typeof json.type === "string", json);
    switch (json.type) {
        case "user":
            console.assert(typeof json.id      === "string", json);
            console.assert(typeof json.name    === "string", json);
            console.assert(typeof json.iconUrl === "string", json);
            console.assert(typeof json.url     === "string", json);
            return {
                type: "user",
                id: json.id,
                name: json.name,
                iconUrl: json.iconUrl,
                url: json.url,
            };

        default:
            console.warn("Unknown actor type:", json);
            return {
                type: "unknown"
            };
    }
}
