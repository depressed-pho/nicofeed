import * as Bacon from 'baconjs';
import { Reveal } from 'foundation-sites';
import * as $ from 'jquery';
import './edit-filter-set.scss';
import 'assets/table/scrollable.scss';
import 'assets/table/selectable.scss';
import { parseHTML } from 'niconico/parse-html';
import { FilterRuleID, FilterAction, FilterRule, FilterRuleSet
       } from 'niconico/feed/filter';
import htmlEditFilterSet from './edit-filter-set.html';

class EditFilterSetView {
    private static _instance: EditFilterSetView;

    private readonly frag: DocumentFragment;
    private readonly divReveal: HTMLDivElement;
    private readonly tbody: HTMLTableSectionElement;
    private readonly tmplRow: HTMLTemplateElement;
    private readonly btnRaise: HTMLButtonElement;
    private readonly btnLower: HTMLButtonElement;
    private readonly btnDelete: HTMLButtonElement;

    private readonly selectedRuleBus: Bacon.Bus<FilterRuleID|null>;
    private readonly selectedRule: Bacon.Property<FilterRuleID|null>;

    private readonly ruleSetModifiedBus: Bacon.Bus<null>;

    private filterRules?: FilterRuleSet;
    private onClose?: (isModified: boolean) => void;
    private isModified: boolean;

    public static get singleton(): EditFilterSetView {
        if (!this._instance) {
            this._instance = new EditFilterSetView();
        }
        return this._instance;
    }

    private constructor() {
        this.frag       = parseHTML(htmlEditFilterSet);
        this.divReveal  = this.frag.querySelector<HTMLDivElement>("div.reveal")!;
        this.tbody      = this.frag.querySelector<HTMLTableSectionElement>("table > tbody")!;
        this.tmplRow    = this.frag.querySelector<HTMLTemplateElement>("template[data-for='row']")!;
        this.btnRaise   = this.frag.querySelector<HTMLButtonElement>("button[data-for='raise-priority']")!;
        this.btnLower   = this.frag.querySelector<HTMLButtonElement>("button[data-for='lower-priority']")!;
        this.btnDelete  = this.frag.querySelector<HTMLButtonElement>("button[data-for='delete']")!;
        this.isModified = false;

        this.selectedRuleBus = new Bacon.Bus<FilterRuleID|null>();
        this.selectedRule    = this.selectedRuleBus.toProperty(null);
        this.selectedRule.onValue(sel => this.highlight(sel));

        this.ruleSetModifiedBus = new Bacon.Bus<null>();
        this.ruleSetModifiedBus.onValue(() => {
            this.isModified = true;
        });

        /* The "Raise the priority" button is enabled when a rule is
         * selected and it's not the most prioritized rule. */
        this.selectedRule
            .toEventStream()
            .merge(this.selectedRule.sampledBy(this.ruleSetModifiedBus))
            .onValue(async sel => {
                this.btnRaise.disabled =
                    !sel || await this.indexOf(sel) == 0;
            });
        const raiseClicked = Bacon.fromEvent(this.btnRaise, "click");
        this.selectedRule.sampledBy(raiseClicked).onValue(async sel => {
            if (sel) {
                await this.onRaisePriority(sel);
            }
        });

        /* The "Lower the priority" button is enabled when a rule is
         * selected and it's not the least prioritized rule. */
        this.selectedRule
            .toEventStream()
            .merge(this.selectedRule.sampledBy(this.ruleSetModifiedBus))
            .onValue(async sel => {
            this.btnLower.disabled =
                !sel || await this.indexOf(sel) == await this.filterRules!.count() - 1;
        });
        const lowerClicked = Bacon.fromEvent(this.btnLower, "click");
        this.selectedRule.sampledBy(lowerClicked).onValue(async sel => {
            if (sel) {
                await this.onLowerPriority(sel);
            }
        });

        /* The "Delete the rule" button is enabled when a rule is
         * selected. There is no confirmation at the moment. */
        this.selectedRule.onValue(sel => {
            this.btnDelete.disabled = sel == null;
        });
        const deleteClicked = Bacon.fromEvent(this.btnDelete, "click");
        this.selectedRule.sampledBy(deleteClicked).onValue(async sel => {
            if (sel) {
                await this.onDelete(sel);
            }
        });

        // Foundation uses jQuery events as opposed to the native DOM
        // events.
        $(this.divReveal).on("closed.zf.reveal", () => {
            if (this.onClose) {
                this.onClose(this.isModified);
                delete this.onClose;
            }
            this.isModified = false;
        });
    }

    private async indexOf(ruleID: FilterRuleID): Promise<number> {
        const rules = await this.filterRules!.toArray();
        const index = rules.findIndex(rule => rule.id == ruleID);
        if (index >= 0) {
            return index;
        }
        else {
            throw new Error(`Rule not found: ${ruleID}`);
        }
    }

    private async ruleAt(index: number): Promise<FilterRule> {
        const rules = await this.filterRules!.toArray();
        if (index >= 0 && index < rules.length) {
            return rules[index]!;
        }
        else {
            throw new Error(`Index out of bounds: ${index}`);
        }
    }

    public async open(filterRules: FilterRuleSet, onClose: (isModified: boolean) => void): Promise<void> {
        this.filterRules = filterRules;
        this.onClose     = onClose;
        this.isModified  = false;

        await this.refreshRules();
        this.selectedRuleBus.push(null);

        if (document.getElementById("nicofeed-edit-filter-set")) {
            $(this.divReveal).foundation("open");
        }
        else {
            const body = document.querySelector<HTMLBodyElement>("body")!;
            body.appendChild(this.frag);

            new Reveal($(this.divReveal)).open();
        }
    }

    private async refreshRules(): Promise<void> {
        this.tbody.replaceChildren();
        for (const rule of await this.filterRules!.toArray()) {
            /* For whatever reason, Node#cloneNode() returns Node, not
             * polymorphic this. Isn't this a bug in the type spec? */
            const row = this.tmplRow.content.cloneNode(true) as DocumentFragment;

            const tr = row.querySelector<HTMLTableRowElement>("tr")!;
            tr.dataset["id"] = rule.id; // highlight() uses this.
            tr.addEventListener("click", () => {
                // Select it when clicked.
                this.selectedRuleBus.push(rule.id);
            });

            // Rule
            const colRule    = row.querySelector<HTMLTableDataCellElement>("tr > td.nicofeed-rule")!;

            const spanAction = colRule.querySelector<HTMLSpanElement>("span[data-for='action']")!;
            const tmplAction = rule.action === FilterAction.Show ?
                spanAction.querySelector<HTMLTemplateElement>("template[data-for='show']")! :
                spanAction.querySelector<HTMLTemplateElement>("template[data-for='hide']")!;
            spanAction.replaceChildren(); // Remove templates
            spanAction.appendChild(tmplAction.content);

            const spanActor = colRule.querySelector<HTMLSpanElement>("span[data-for='actor']")!;
            const tmplUser  = spanActor.querySelector<HTMLTemplateElement>("template[data-for='user']")!;
            const tmplAny   = spanActor.querySelector<HTMLTemplateElement>("template[data-for='any']")!;
            spanActor.replaceChildren(); // Remove templates
            if (rule.actor && rule.actor.type === "user") {
                const frag     = tmplUser.content;

                const aUser    = frag.querySelector<HTMLAnchorElement>("a.nicofeed-user")!;
                aUser.href     = rule.actor.url;

                const imgUser  = frag.querySelector<HTMLImageElement>("img.nicofeed-user-icon")!;
                imgUser.src    = rule.actor.iconUrl;

                const spanUser = frag.querySelector<HTMLSpanElement>("span.nicofeed-user-name")!;
                spanUser.textContent = rule.actor.name;

                spanActor.appendChild(frag);
            }
            else {
                spanActor.appendChild(tmplAny.content);
            }

            const spanKind = colRule.querySelector<HTMLSpanElement>("span[data-for='kind']")!;
            const tmplKind = rule.kind ?
                spanKind.querySelector<HTMLTemplateElement>(`template[data-for='${rule.kind}']`)! :
                spanKind.querySelector<HTMLTemplateElement>("template[data-for='any']")!;
            spanKind.replaceChildren(); // Remove templates
            spanKind.appendChild(tmplKind.content);

            const spanType = colRule.querySelector<HTMLSpanElement>("span[data-for='type']")!;
            const tmplType = rule.type ?
                spanType.querySelector<HTMLTemplateElement>(`template[data-for='${rule.type}']`)! :
                spanType.querySelector<HTMLTemplateElement>("template[data-for='any']")!;
            spanType.replaceChildren(); // Remove templates
            spanType.appendChild(tmplType.content);

            // #Fired
            const colNumFired = row.querySelector<HTMLTableDataCellElement>("tr > td.nicofeed-num-fired")!;
            colNumFired.textContent = String(rule.numFired);

            // Last fired
            const colLastFired = row.querySelector<HTMLTableDataCellElement>("tr > td.nicofeed-last-fired")!;
            colLastFired.textContent = rule.lastFired ? rule.lastFired.toLocaleString() : '';

            this.tbody.appendChild(row);
        }
    }

    private highlight(ruleID: FilterRuleID|null) {
        for (const tr of this.tbody.querySelectorAll("tr")) {
            if (tr.dataset["id"] && ruleID && tr.dataset["id"] == ruleID) {
                tr.classList.add("nicofeed-selected");
            }
            else {
                tr.classList.remove("nicofeed-selected");
            }
        }
    }

    private async onRaisePriority(ruleID: FilterRuleID) {
        const thisIndex = await this.indexOf(ruleID);
        const prevRule  = await this.ruleAt(thisIndex - 1);
        this.swap(ruleID, prevRule.id);
    }

    private async onLowerPriority(ruleID: FilterRuleID) {
        const thisIndex = await this.indexOf(ruleID);
        const nextRule  = await this.ruleAt(thisIndex + 1);
        this.swap(ruleID, nextRule.id);
    }

    private async swap(idA: FilterRuleID, idB: FilterRuleID) {
        /* Swap priorities in the database. */
        await this.filterRules!.swap(idA, idB);

        /* Swap rules in the view. */
        let trA: Element|undefined;
        let trB: Element|undefined;
        for (const tr of this.tbody.querySelectorAll("tr")) {
            if (tr.dataset["id"]) {
                if (tr.dataset["id"] == idA) {
                    trA = tr;
                }
                else if (tr.dataset["id"] == idB) {
                    trB = tr;
                }
            }
        }
        if (!trA || !trB) {
            throw new Error("internal error");
        }

        const prevA = trA.previousSibling;
        const prevB = trB.previousSibling;
        trA.parentNode!.removeChild(trA);
        trB.parentNode!.removeChild(trB);

        if (prevA) {
            prevA.after(trB);
        }
        else {
            this.tbody.prepend(trB);
        }

        if (prevB) {
            prevB.after(trA);
        }
        else {
            this.tbody.prepend(trA);
        }

        /* Notify that the set of rules has been modified. */
        this.ruleSetModifiedBus.push(null);
    }

    private async onDelete(id: FilterRuleID) {
        /* Remove it from the database. */
        await this.filterRules!.remove(id);

        /* Remove it from the view. */
        const tr = this.tbody.querySelector(`tr[data-id='${id}']`)!;
        tr.parentNode!.removeChild(tr);

        /* Deselect the rule. */
        this.selectedRuleBus.push(null);

        /* Notify that the set of rules has been modified. */
        this.ruleSetModifiedBus.push(null);
    }
}

/** Open up a modal dialog letting the user edit the set of filtering
 * rules, and return a Promise which fulfills with true if the set of
 * rules is modified, or false otherwise. */
export function editFilterSet(filterRules: FilterRuleSet): Promise<boolean> {
    return new Promise((resolve) => {
        EditFilterSetView.singleton.open(filterRules, resolve);
    });
}
