import { type FormEvent, useState } from "react";
import { useAuthStore } from "../store/authStore";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });

  function validate(): boolean {
    const errs = { email: "", password: "" };
    if (!email.trim()) errs.email = "Email is required";
    if (!password) errs.password = "Password is required";
    setFieldErrors(errs);
    return !errs.email && !errs.password;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    if (!validate()) return;
    await login(email.trim(), password);
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>PULSE CONNECT</h1>
          <p className={styles.subtitle}>Gaming Social Platform</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Email</label>
            <input
              id="email"
              className={`${styles.input} ${fieldErrors.email ? styles.inputError : ""}`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFieldErrors((f) => ({ ...f, email: "" })); }}
              disabled={isLoading}
              maxLength={254}
              placeholder="player@pulse.gg"
            />
            {fieldErrors.email && (
              <span className={styles.fieldError}>{fieldErrors.email}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              className={`${styles.input} ${fieldErrors.password ? styles.inputError : ""}`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: "" })); }}
              disabled={isLoading}
              maxLength={128}
              placeholder="••••••••"
            />
            {fieldErrors.password && (
              <span className={styles.fieldError}>{fieldErrors.password}</span>
            )}
          </div>

          {error && (
            <div className={styles.errorBanner} role="alert">
              {error.code === "INVALID_CREDENTIALS"
                ? "Invalid email or password"
                : error.message}
            </div>
          )}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className={styles.spinner} aria-hidden="true" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
