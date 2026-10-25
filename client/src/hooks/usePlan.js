import { useQuery } from '@tanstack/react-query';
import api from '../api/index';
import { useAuthStore } from '../store/auth';

export function usePlan() {
  const { user } = useAuthStore();

  // Fetch usage stats and plan configuration from the server
  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: () => api.get('/tenants/me/usage').then(r => r.data),
    enabled: !!user,
    staleTime: 60000, // Cache for 1 minute
  });

  const plan = data?.plan;
  const usage = data?.usage;
  const subscription = data?.subscription;

  /**
   * Check if a specific feature is enabled in the current plan.
   * e.g., 'csv_import', 'payout_automation', 'full_reports', etc.
   */
  const hasFeature = (featureKey) => {
    if (user?.role === 'super_admin') return true;
    if (!plan?.features) return false;
    return plan.features.includes(featureKey);
  };

  /**
   * Check if a resource limit has been reached or exceeded.
   * limitKey can be: 'workers' | 'products' | 'platforms'
   */
  const isLimitReached = (limitKey) => {
    if (user?.role === 'super_admin') return false;
    const resource = usage?.[limitKey];
    if (!resource) return false;
    if (resource.unlimited) return false;
    return resource.used >= resource.limit;
  };

  /**
   * Get the remaining quota for a resource.
   * Returns Infinity if the resource is unlimited.
   */
  const getLimitRemaining = (limitKey) => {
    const resource = usage?.[limitKey];
    if (!resource) return 0;
    if (resource.unlimited) return Infinity;
    return Math.max(0, resource.limit - resource.used);
  };

  return {
    plan,
    usage,
    subscription,
    isLoading,
    refetch,
    error,
    hasFeature,
    isLimitReached,
    getLimitRemaining,
  };
}
