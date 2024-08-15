import { Reveal } from 'foundation-sites';
import * as $ from 'jquery';
import './sign-in.scss';
import { parseHTML } from 'niconico/parse-html';
import htmlSignIn from './sign-in.html';

class SignInView {
    private static _instance: SignInView;
    private readonly frag: DocumentFragment;
    private readonly divReveal: HTMLDivElement;
    private readonly form: HTMLFormElement;
    private readonly btnSubmit: HTMLButtonElement;
    private onRetry?: () => void;

    public static get singleton(): SignInView {
        if (!this._instance) {
            this._instance = new SignInView();
        }
        return this._instance;
    }

    private constructor() {
        this.frag       = parseHTML(htmlSignIn);
        this.divReveal  = this.frag.querySelector<HTMLDivElement>("div.reveal")!;
        this.form       = this.frag.querySelector<HTMLFormElement>("form")!;
        this.btnSubmit  = this.form.querySelector<HTMLButtonElement>("button[type='submit']")!;

        this.btnSubmit.addEventListener("click", ev => {
            ev.preventDefault();
            this.onSubmit();
        }, {once: true});
    }

    public open(onRetry: () => void): void {
        this.onRetry = onRetry;

        if (document.getElementById("nicofeed-sign-in")) {
            $(this.divReveal).foundation("open");
        }
        else {
            const body = document.querySelector<HTMLBodyElement>("body")!;
            body.appendChild(this.frag);

            new Reveal($(this.divReveal)).open();
        }
    }

    private async onSubmit(): Promise<void> {
        $(this.divReveal).foundation("close");
        this.onRetry!();
    }
}

/** Open up a modal dialog asking for credentials, wait for user input
 * and fulfill when it succeeds. The promise never rejects as it
 * continues asking the user to retry.
 */
export function signIn(): Promise<void> {
    return new Promise((resolve) => {
        SignInView.singleton.open(resolve);
    });
}
