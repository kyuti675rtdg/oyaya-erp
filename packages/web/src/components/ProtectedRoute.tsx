import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';

/**
 * Guards routes: requires a JWT, and optionally one of the given permission claims.
 * Users without the claim are sent to the dashboard.
 */
export function ProtectedRoute({
  claim,
  children
}: {
  claim?: string | string[];
  children: ReactNode;
}) {
  const { token, hasAnyClaim } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (claim) {
    const claims = Array.isArray(claim) ? claim : [claim];
    if (!hasAnyClaim(claims)) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}
