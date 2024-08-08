import { Reveal } from 'foundation-sites';
import * as $ from 'jquery';
import './sign-in.scss';
import { parseHTML } from 'niconico/parse-html';
import * as Auth from 'niconico/auth';
import { UnauthorizedError } from 'niconico/errors';
import htmlSignIn from './sign-in.html';

class SignInView {
    private static _instance: SignInView;
    private readonly frag: DocumentFragment;
    private readonly divReveal: HTMLDivElement;
    private readonly form: HTMLFormElement;
    private readonly inUser: HTMLInputElement;
    private readonly inPassword: HTMLInputElement;
    private readonly btnSubmit: HTMLButtonElement;
    private readonly divError: HTMLDivElement;
    private onSucceeded?: () => void;

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
        this.inUser     = this.form.querySelector<HTMLInputElement>("input[type='text']")!;
        this.inPassword = this.form.querySelector<HTMLInputElement>("input[type='password']")!;
        this.btnSubmit  = this.form.querySelector<HTMLButtonElement>("button[type='submit']")!;
        this.divError   = this.form.querySelector<HTMLDivElement>("div.nicofeed-error")!;

        this.divError.style.display = 'none';

        this.btnSubmit.addEventListener("click", ev => {
            ev.preventDefault();
            this.onSubmit();
        }, {once: true});

        // Foundation uses jQuery events as opposed to the native DOM
        // events.
        $(this.divReveal).on("open.zf.reveal", () => {
            this.inUser.focus();
        });
    }

    public open(onSucceeded: () => void): void {
        this.onSucceeded = onSucceeded;

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
        if (!this.form.reportValidity()) {
            return;
        }
        try {
            this.btnSubmit.disabled = true;
            await Auth.signIn({
                user: this.inUser.value,
                password: this.inPassword.value
            });
            $(this.divReveal).foundation("close");
            this.onSucceeded!();
        }
        catch (e) {
            if (e instanceof UnauthorizedError) {
                this.divError.textContent = 'Invalid user ID or password.';
                this.divError.style.display = '';
            }
            else {
                throw e;
            }
        }
        finally {
            this.btnSubmit.disabled = false;
        }
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
