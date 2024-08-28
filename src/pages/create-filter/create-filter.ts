import { Reveal } from 'foundation-sites';
import * as $ from 'jquery';
import './create-filter.scss';
import { parseHTML } from 'niconico/parse-html';
import { ActivityKind, ContentType, Activity } from 'niconico/feed';
import { FilterAction, IFilterRule } from 'niconico/feed/filter';
import htmlCreateFilter from './create-filter.html';

class CreateFilterView {
    private static _instance: CreateFilterView;
    private readonly frag: DocumentFragment;
    private readonly divReveal: HTMLDivElement;
    private readonly form: HTMLFormElement;
    private readonly selAction: HTMLSelectElement;
    private readonly selActor: HTMLSelectElement;
    private readonly optIndividual: HTMLOptionElement;
    private readonly selKind: HTMLSelectElement;
    private readonly selType: HTMLSelectElement;
    private readonly btnCancel: HTMLButtonElement;
    private readonly btnSubmit: HTMLButtonElement;
    private activity?: Activity;
    private onClose?: (rule?: IFilterRule) => void;

    public static get singleton(): CreateFilterView {
        if (!this._instance) {
            this._instance = new CreateFilterView();
        }
        return this._instance;
    }

    private constructor() {
        this.frag          = parseHTML(htmlCreateFilter);
        this.divReveal     = this.frag.querySelector<HTMLDivElement>("div.reveal")!;
        this.form          = this.frag.querySelector<HTMLFormElement>("form")!;
        this.selAction     = this.form.querySelector<HTMLSelectElement>("select[name='action']")!;
        this.selActor      = this.form.querySelector<HTMLSelectElement>("select[name='actor']")!;
        this.optIndividual = this.selActor.querySelector<HTMLOptionElement>("option[value='individual']")!;
        this.selKind       = this.form.querySelector<HTMLSelectElement>("select[name='kind']")!;
        this.selType       = this.form.querySelector<HTMLSelectElement>("select[name='type']")!;
        this.btnCancel     = this.form.querySelector<HTMLButtonElement>("button.secondary")!;
        this.btnSubmit     = this.form.querySelector<HTMLButtonElement>("button[type='submit']")!;

        this.btnCancel.addEventListener("click", () => this.close());
        this.btnSubmit.addEventListener("click", ev => {
            ev.preventDefault();
            this.submit();
        });

        // Foundation uses jQuery events as opposed to the native DOM
        // events.
        $(this.divReveal).on("closed.zf.reveal", () => {
            if (this.onClose) {
                this.onClose(undefined);
            }
        });
    }

    public open(activity: Activity, onClose: (rule?: IFilterRule) => void): void {
        this.activity = activity;
        this.onClose  = onClose;

        this.selAction.value    = "hide";
        this.selActor.value     = "individual";
        this.optIndividual.text = activity.actor.type === "unknown" ? "" : activity.actor.name;
        this.selKind.value      = activity.kind === "unknown" ? "any" : activity.kind;
        if (activity.content)
            this.selType.value = activity.content.type === "unknown" ? "any" : activity.content.type;
        else
            this.selType.value = "any";

        if (document.getElementById("nicofeed-create-filter")) {
            $(this.divReveal).foundation("open");
        }
        else {
            const body = document.querySelector<HTMLBodyElement>("body")!;
            body.appendChild(this.frag);

            new Reveal($(this.divReveal)).open();
        }
    }

    private toRule(): IFilterRule {
        if (this.activity) {
            const rule: IFilterRule = {
                action: this.selAction.value == "show"
                    ? FilterAction.Show : FilterAction.Hide
            };
            if (this.selActor.value == "individual") {
                rule.actor = this.activity.actor;
            }
            if (this.selKind.value != "any") {
                rule.kind = this.selKind.value as ActivityKind;
            }
            if (this.selType.value != "any") {
                rule.type = this.selType.value as ContentType;
            }
            return rule;
        }
        else {
            throw new Error("No entries have been set.");
        }
    }

    private close() {
        $(this.divReveal).foundation("close");
    }

    private submit() {
        if (this.onClose) {
            this.onClose(this.toRule());
            delete this.onClose;
        }
        this.close();
    }
}

/** Open up a modal dialog letting the user to create a filter from an
 * activity, wait for user input and fulfill when it succeeds. The promise
 * fulfills with "undefined" when the user cancels the modal.
 */
export function createFilter(activity: Activity): Promise<IFilterRule|undefined> {
    return new Promise((resolve) => {
        CreateFilterView.singleton.open(activity, resolve);
    });
}
