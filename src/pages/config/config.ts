import 'foundation-sites';
import * as $ from 'jquery';
import './config.scss';
import { ConfigModel } from './config-model';
import { ConfigView } from './config-view';

/* This is the entry point of /assets/pages/config/config.html and is
 * a controller in the MVC sense.
 */

window.addEventListener("DOMContentLoaded", async () => {
    $(document).foundation();

    const configModel = new ConfigModel();
    const configView  = new ConfigView(configModel);
});
