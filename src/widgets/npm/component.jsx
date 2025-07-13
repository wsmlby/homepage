import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import classNames from "classnames";

import useWidgetAPI from "utils/proxy/use-widget-api";

export default function Component({ service }) {
  const { widget } = service;

  const { data: infoData, error: infoError } = useWidgetAPI(widget, "hosts", {
    shouldRetryOnError: (error) => error?.status !== 404,
  });

  if (infoError) {
    return <Container service={service} error={infoError} />;
  }

  if (!infoData) {
    return (
      <Container service={service}>
        <Block label="npm.enabled" />
        <Block label="npm.disabled" />
        <Block label="npm.total" />
      </Container>
    );
  }

  const enabled = infoData.filter((c) => !!c.enabled).length;
  const disabled = infoData.filter((c) => !c.enabled).length;
  const total = infoData.length;
  const suffixesOrdered = (widget.domain_suffixes || []).sort((a, b) => b.length - a.length);
  const site_data = infoData.filter(c => c.enabled || widget.show_disabled).map((c) => ({
    id: c.id,
    title: c.title,
    icon: c.icon,
    hosts: c.domain_names.map((host) => {
      host = host.trim();
      let suffixed = host;
      for (const suffix of suffixesOrdered) {
        if (host.endsWith(suffix)) {
          suffixed = host.slice(0, -suffix.length);
          break;
        }
      }
      return { host, suffixed };
    }),
  }));

  return (
    <div>
      <Container service={service}>
        <Block label="npm.enabled" value={enabled} />
        <Block label="npm.disabled" value={disabled} />
        <Block label="npm.total" value={total} />

      </Container>
      {widget.show_hosts && site_data && (
        <div className="flex flex-wrap auto-rows-max">
          {site_data.map(c => (
            <div key={c.id} className={classNames(
                    "bg-theme-200/50 dark:bg-theme-900/20 rounded-sm m-1 flex-1 flex flex-col items-center justify-center text-center p-1")}>
              <a href={`https://${c.hosts[0].host}`} target="_blank" rel="noopener noreferrer">
                {c.icon && (
                  <img src={c.icon} alt={c.title || c.hosts[0].suffixed} className="w-6 h-6 rounded-full mb-2" />)
                }
                <p className="col-span-2 text-sm">{c.title || c.hosts[0].suffixed}</p>
              </a>
              {c.hosts.length > 1 && (
              <div className="col-span-4 grid grid-cols-2">
                {
                  c.hosts.slice(1).map((host, idx) => (
                    <p key={idx} class="text-gray-500 col-span-1"><a href={`https://${host.host}`} target="_blank" style={{ fontSize: "xx-small" }}
                        rel="noopener noreferrer" class="px-3 py-2 text-xx-small text-center inline-flex items-center text-white rounded-lg group bg-gradient-to-br from-purple-600 to-blue-500">
                        {host.suffixed}
                    </a></p>
                  ))
                }
              </div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
