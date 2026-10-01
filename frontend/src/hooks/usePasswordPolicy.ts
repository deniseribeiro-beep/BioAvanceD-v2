import { useEffect, useState } from 'react';
import { authService } from '../services/api';
import { DEFAULT_PASSWORD_RULES, PasswordStrengthRules } from '../utils/passwordRules';

// #1246: the passwordRules strength keys in force, from the public
// GET /api/auth/password-policy. Starts at, and on any failure stays at, the
// backend's own default, so a form never shows looser rules than the server's
// default; the server checks again on submit either way.
export function usePasswordPolicy(): PasswordStrengthRules {
  const [rules, setRules] = useState<PasswordStrengthRules>(DEFAULT_PASSWORD_RULES);

  useEffect(() => {
    let active = true;
    authService
      .getPasswordPolicy()
      .then((response) => {
        const data = response?.data?.data;
        if (active && data && Number.isInteger(data.minLength)) {
          setRules({
            minLength: data.minLength,
            requireUppercase: data.requireUppercase !== false,
            requireLowercase: data.requireLowercase !== false,
            requireNumbers: data.requireNumbers !== false,
            requireSpecialChars: data.requireSpecialChars !== false,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return rules;
}

// #1249: authentication.allowPasswordReset, from the same public route. True
// until the policy says otherwise, and on any failure; the server refuses the
// flow on its own either way.
export function usePasswordResetAllowed(): boolean {
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let active = true;
    authService
      .getPasswordPolicy()
      .then((response) => {
        if (active && response?.data?.data?.allowPasswordReset === false) setAllowed(false);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return allowed;
}
