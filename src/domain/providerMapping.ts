import { ProxyProvider } from './entities/dashboard';

export const findProviderForSubscription = (providers: ProxyProvider[], subscriptionName: string): ProxyProvider | undefined => {
  const normalizedSubscription = subscriptionName.trim().toLocaleLowerCase();
  return providers.find(provider => provider.name.trim().toLocaleLowerCase() === normalizedSubscription);
};

export const findProviderForNode = (providers: ProxyProvider[], nodeName: string): ProxyProvider | undefined =>
  providers.find(provider => provider.nodes.some(node => node.name === nodeName));

export const bestProviderDelay = (provider?: ProxyProvider): number | undefined => {
  if (!provider) return undefined;
  const delays = provider.nodes
    .map(node => node.delay)
    .filter((delay): delay is number => typeof delay === 'number' && delay > 0);
  return delays.length ? Math.min(...delays) : undefined;
};
