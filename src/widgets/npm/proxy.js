import cache from "memory-cache";
import HTMLParser from "node-html-parser";

import html_entity_decode from "./html_entity_decode";

import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { formatApiCall } from "utils/proxy/api-helpers";
import { httpProxy } from "utils/proxy/http";
import widgets from "widgets/widgets";


const proxyName = "npmProxyHandler";
const tokenCacheKey = `${proxyName}__token`;
const siteInfoCacheKey = `${proxyName}__site_info`;
const logger = createLogger(proxyName);

async function login(loginUrl, username, password, service) {
  const authResponse = await httpProxy(loginUrl, {
    method: "POST",
    body: JSON.stringify({ identity: username, secret: password }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  const status = authResponse[0];
  let data = authResponse[2];

  try {
    data = JSON.parse(Buffer.from(authResponse[2]).toString());

    if (status === 200) {
      const expiration = new Date(data.expires) - Date.now();
      cache.put(`${tokenCacheKey}.${service}`, data.token, expiration - 5 * 60 * 1000); // expiration -5 minutes
    }
  } catch (e) {
    logger.error(`Error ${status} logging into npm`, JSON.stringify(authResponse[2]));
  }
  return [status, data.token ?? data];
}
async function parse_info(content, url) {
  var root = HTMLParser.parse(content);
  // let title = null;
  let icon = null;
  try {
    icon = root.querySelector('link[rel="shortcut icon"]').getAttribute('href');
    icon = new URL(icon, url).href;
  } catch (e) { }
  if (!icon) {
    try {
      icon = root.querySelector('link[rel="icon"]').getAttribute('href');
      icon = new URL(icon, url).href;
    } catch (e) { }
  }
  // try {
  //   title = html_entity_decode(root.querySelector('head > title').innerText);
  // } catch (e) {
  //   // console.error("Error parsing title for site: " + host, e);
  // };
  return { icon: icon ? icon : null };
}
async function fetch_and_parse(hostinfo) {
  if (!hostinfo || !hostinfo.domain_names || hostinfo.domain_names.length === 0 || !hostinfo.enabled) {
    return { icon: null };
  }
  const host = hostinfo.domain_names[0].trim();
  let site_info = cache.get(`${siteInfoCacheKey}.${host}`);
  if (site_info) {
    return site_info;
  }

  const url = new URL(`https://${host}/`);
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) { return { title: null, icon: null }; }
  const text = await response.text();
  const rst = await parse_info(text, url);
  cache.put(`${siteInfoCacheKey}.${host}`, rst, (rst.icon === null ? 1: 60) * 60 * 1000); // cache for 1 minute for failed one, 1 hour for successful one
  return rst;
}

export default async function npmProxyHandler(req, res) {
  const { group, service, endpoint, index } = req.query;

  if (group && service) {
    const widget = await getServiceWidget(group, service, index);

    if (!widgets?.[widget.type]?.api) {
      return res.status(403).json({ error: "Service does not support API calls" });
    }

    if (widget) {
      const url = new URL(formatApiCall(widgets[widget.type].api, { endpoint, ...widget }));
      const loginUrl = `${widget.url}/api/tokens`;

      let status;
      let data;

      let token = cache.get(`${tokenCacheKey}.${service}`);
      if (!token) {
        [status, token] = await login(loginUrl, widget.username, widget.password, service);
        if (status !== 200) {
          logger.debug(`HTTP ${status} logging into npm api: ${token}`);
          return res.status(status).send(token);
        }
      }

      [status, , data] = await httpProxy(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (status === 403) {
        logger.debug(`HTTP ${status} retrieving data from npm api, logging in and trying again.`);
        cache.del(`${tokenCacheKey}.${service}`);
        [status, token] = await login(loginUrl, widget.username, widget.password, service);

        if (status !== 200) {
          logger.debug(`HTTP ${status} logging into npm api: ${data}`);
          return res.status(status).send(data);
        }

        // eslint-disable-next-line no-unused-vars
        [status, , data] = await httpProxy(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
      }

      if (status !== 200) {
        return res.status(status).send(data);
      }
      if (widget.fetch_info && endpoint === "nginx/proxy-hosts") {
        let hosts = JSON.parse(data);
        await Promise.all(hosts.map(async (host) => {
          try {
            const { icon } = await fetch_and_parse(host);
            if (icon !== null) {
              host.icon = icon;
            }
          }
          catch (e) {
            // console.error(`Error fetching data for host ${host.domain_names[0]}:`, e);
            console.log(`Error fetching data for host ${host.domain_names[0]}:${e.message}`);
          }
        }));
        data = JSON.stringify(hosts);
      }

      return res.send(data);
    }
  }

  return res.status(400).json({ error: "Invalid proxy service type" });
}
