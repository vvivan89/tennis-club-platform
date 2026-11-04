'use client';

import { useEffect, useState } from 'react';

export type HelpGuideTab<T extends string> = readonly [id: T, label: string];
export type HelpGuideTopic<T extends string> = readonly [tab: T, id: string, label: string];

export function helpTopicLinks<T extends string>(topics: readonly HelpGuideTopic<T>[]) {
  return topics.map(([tab, id, label]) => ({ href: `?tab=${tab}#${id}`, label }));
}

export function useHelpGuideNavigation<T extends string>(
  tabs: readonly HelpGuideTab<T>[],
  topics: readonly HelpGuideTopic<T>[],
  initialTab: T,
) {
  const [activeTab, setActiveTab] = useState<T>(initialTab);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (tabs.some(([id]) => id === requested)) setActiveTab(requested as T);
  }, [tabs]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const topic = topics.find(([, id]) => id === hash);
    if (topic?.[0] === activeTab) {
      window.setTimeout(() => document.getElementById(hash)?.scrollIntoView?.(), 0);
    }
  }, [activeTab, topics]);

  function selectTab(tab: T) {
    setActiveTab(tab);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?tab=${tab}`);
  }

  return { activeTab, selectTab };
}
