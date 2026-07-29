/**
 * Full-screen branded splash shown while the app boots (e.g. restoring the
 * session) before routing to real content.
 */
import styles from "./LoadingScreen.module.css";

export function LoadingScreen() {
  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <span className={styles.title}>PULSE CONNECT</span>
        <div className={styles.dots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
      </div>
    </div>
  );
}
