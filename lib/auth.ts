import formurlencoded from 'form-urlencoded';
import { UnauthorizedError } from 'niconico/errors';

export interface Credentials {
    /// Email address or phone number
    user: string,
    password: string
}

export async function signIn(creds: Credentials) {
    // https://account.nicovideo.jp/login/redirector?show_button_twitter=1&site=niconico&show_button_facebook=1&sec=header_pc&next_url=%2F
    const URL = "https://account.nicovideo.jp/login/redirector?site=niconico&sec=header_pc&next_url=%2F";
    const res = await fetch(URL, {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: formurlencoded({
            "mail_tel": creds.user,
            "password": creds.password
        })
    });
    /* The server wants us to redirect to https://www.nicovideo.jp/ on
     * a success, and a login form on a failure. */
    if (/\/login\?/.test(res.url)) {
        throw new UnauthorizedError("Authentication failed");
    }
}

export async function signOut() {
    // https://account.nicovideo.jp/logout?site=niconico&next_url=%2F&sec=header_pc&cmnhd_ref=device%3Dpc%26site%3Dniconico%26pos%3Duserpanel%26page%3Dmy_top
    const URL = "https://account.nicovideo.jp/logout?site=niconico";
    await fetch(URL, {
        method: "GET",
        mode: "cors",
        redirect: "follow"
    });
}
