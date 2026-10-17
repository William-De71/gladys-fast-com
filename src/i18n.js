// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback), the four languages of the Gladys interface.
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names, widget contents, toasts, messages of the
// Configuration screen.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // features
  featureDownload: {
    en: 'Download speed',
    fr: 'Débit descendant',
    de: 'Download-Geschwindigkeit',
    es: 'Velocidad de descarga',
  },
  featureUpload: {
    en: 'Upload speed',
    fr: 'Débit montant',
    de: 'Upload-Geschwindigkeit',
    es: 'Velocidad de subida',
  },
  featureLatency: {
    en: 'Latency (idle)',
    fr: 'Latence au repos',
    de: 'Latenz (Leerlauf)',
    es: 'Latencia en reposo',
  },
  featureJitter: { en: 'Jitter', fr: 'Gigue', de: 'Jitter', es: 'Fluctuación (jitter)' },
  featureLoadedLatency: {
    en: 'Latency under load',
    fr: 'Latence en charge',
    de: 'Latenz unter Last',
    es: 'Latencia con carga',
  },

  // connection status (Configuration screen)
  statusFirst: {
    en: 'Ready: the first test runs in about a minute.',
    fr: 'Prêt : le premier test démarre dans une minute environ.',
    de: 'Bereit: Der erste Test startet in etwa einer Minute.',
    es: 'Listo: la primera prueba empieza en un minuto aproximadamente.',
  },
  statusManual: {
    en: 'Automatic tests disabled: run one from the widget, a scene or the button below.',
    fr: 'Tests automatiques désactivés : lancez-en un depuis le widget, une scène ou le bouton ci-dessous.',
    de: 'Automatische Tests deaktiviert: Starte einen über das Widget, eine Szene oder die Schaltfläche unten.',
    es: 'Pruebas automáticas desactivadas: lanza una desde el widget, una escena o el botón de abajo.',
  },
  statusOk: {
    en: 'Last test ({when}): {summary}.',
    fr: 'Dernier test ({when}) : {summary}.',
    de: 'Letzter Test ({when}): {summary}.',
    es: 'Última prueba ({when}): {summary}.',
  },
  statusOffline: {
    en: 'Internet unreachable since {since} ({count} failed test(s)). Checked again every 5 minutes.',
    fr: 'Internet injoignable depuis {since} ({count} test(s) échoué(s)). Nouvelle vérification toutes les 5 minutes.',
    de: 'Internet nicht erreichbar seit {since} ({count} fehlgeschlagene(r) Test(s)). Erneute Prüfung alle 5 Minuten.',
    es: 'Internet inaccesible desde {since} ({count} prueba(s) fallida(s)). Nueva comprobación cada 5 minutos.',
  },
  statusService: {
    en: 'Fast.com refused the test ({reason}): it may have changed. Checked again every 5 minutes.',
    fr: 'Fast.com a refusé le test ({reason}) : le service a peut-être changé. Nouvelle vérification toutes les 5 minutes.',
    de: 'Fast.com hat den Test abgelehnt ({reason}): Der Dienst hat sich vielleicht geändert. Erneute Prüfung alle 5 Minuten.',
    es: 'Fast.com rechazó la prueba ({reason}): quizá el servicio ha cambiado. Nueva comprobación cada 5 minutos.',
  },
  statusMeasurement: {
    en: 'The last test measured nothing ({reason}). New try at the next test.',
    fr: 'Le dernier test n’a rien mesuré ({reason}). Nouvel essai au prochain test.',
    de: 'Der letzte Test hat nichts gemessen ({reason}). Neuer Versuch beim nächsten Test.',
    es: 'La última prueba no midió nada ({reason}). Nuevo intento en la próxima prueba.',
  },

  // results and toasts
  testDone: {
    en: 'Test done: {summary} (server: {server}).',
    fr: 'Test terminé : {summary} (serveur : {server}).',
    de: 'Test abgeschlossen: {summary} (Server: {server}).',
    es: 'Prueba terminada: {summary} (servidor: {server}).',
  },
  testFailed: {
    en: 'The test failed: {reason}.',
    fr: 'Le test a échoué : {reason}.',
    de: 'Der Test ist fehlgeschlagen: {reason}.',
    es: 'La prueba ha fallado: {reason}.',
  },
  testStarted: {
    en: 'Test started: 15 to 40 seconds. The widget shows the result at the end.',
    fr: 'Test lancé : 15 à 40 secondes. Le widget affiche le résultat à la fin.',
    de: 'Test gestartet: 15 bis 40 Sekunden. Das Widget zeigt das Ergebnis am Ende.',
    es: 'Prueba iniciada: de 15 a 40 segundos. El widget muestra el resultado al final.',
  },
  testRunning: {
    en: 'A test is already running: the widget shows the result at the end.',
    fr: 'Un test est déjà en cours : le widget affiche le résultat à la fin.',
    de: 'Es läuft bereits ein Test: Das Widget zeigt das Ergebnis am Ende.',
    es: 'Ya hay una prueba en curso: el widget muestra el resultado al final.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration (no IP address).',
    fr: 'Diagnostic écrit dans les journaux de l’intégration (sans adresse IP).',
    de: 'Diagnose in die Protokolle der Integration geschrieben (ohne IP-Adresse).',
    es: 'Diagnóstico escrito en los registros de la integración (sin dirección IP).',
  },

  // failure reasons
  reason_offline: {
    en: 'Internet or Fast.com unreachable',
    fr: 'Internet ou Fast.com injoignable',
    de: 'Internet oder Fast.com nicht erreichbar',
    es: 'Internet o Fast.com inaccesible',
  },
  reason_service: {
    en: 'Fast.com refused the test',
    fr: 'Fast.com a refusé le test',
    de: 'Fast.com hat den Test abgelehnt',
    es: 'Fast.com rechazó la prueba',
  },
  reason_measurement: {
    en: 'no data could be transferred',
    fr: 'aucune donnée n’a pu être transférée',
    de: 'es konnten keine Daten übertragen werden',
    es: 'no se pudo transferir ningún dato',
  },

  // widget
  tileDownload: { en: 'Download', fr: 'Descendant', de: 'Download', es: 'Descarga' },
  tileUpload: { en: 'Upload', fr: 'Montant', de: 'Upload', es: 'Subida' },
  tileLatency: { en: 'Latency', fr: 'Latence', de: 'Latenz', es: 'Latencia' },
  rowLoaded: { en: 'Under load', fr: 'En charge', de: 'Unter Last', es: 'Con carga' },
  rowJitter: { en: 'Jitter', fr: 'Gigue', de: 'Jitter', es: 'Fluctuación' },
  rowServer: {
    en: 'Netflix server',
    fr: 'Serveur Netflix',
    de: 'Netflix-Server',
    es: 'Servidor Netflix',
  },
  rowData: { en: 'Data used', fr: 'Données utilisées', de: 'Datenvolumen', es: 'Datos usados' },
  rowNext: { en: 'Next test', fr: 'Prochain test', de: 'Nächster Test', es: 'Próxima prueba' },
  rowStatus: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
  notMeasured: { en: 'not measured', fr: 'non mesurée', de: 'nicht gemessen', es: 'no medida' },
  onDemand: { en: 'on demand', fr: 'à la demande', de: 'auf Abruf', es: 'a demanda' },
  running: {
    en: 'Test in progress…',
    fr: 'Test en cours…',
    de: 'Test läuft…',
    es: 'Prueba en curso…',
  },
  phase_latency: {
    en: 'measuring the latency',
    fr: 'mesure de la latence',
    de: 'Latenz wird gemessen',
    es: 'midiendo la latencia',
  },
  phase_download: {
    en: 'measuring the download',
    fr: 'mesure du débit descendant',
    de: 'Download wird gemessen',
    es: 'midiendo la descarga',
  },
  phase_upload: {
    en: 'measuring the upload',
    fr: 'mesure du débit montant',
    de: 'Upload wird gemessen',
    es: 'midiendo la subida',
  },
  captionResult: {
    en: '{isp} · tested {ago}',
    fr: '{isp} · testé {ago}',
    de: '{isp} · getestet {ago}',
    es: '{isp} · probado {ago}',
  },
  noResult: {
    en: 'No test yet: press "Run a test" (15 to 40 seconds).',
    fr: 'Aucun test pour l’instant : appuyez sur « Lancer un test » (15 à 40 secondes).',
    de: 'Noch kein Test: Drücke auf „Test starten“ (15 bis 40 Sekunden).',
    es: 'Aún no hay pruebas: pulsa «Iniciar prueba» (de 15 a 40 segundos).',
  },
  lastFailed: {
    en: 'Last test failed {ago}: {reason}.',
    fr: 'Dernier test échoué {ago} : {reason}.',
    de: 'Letzter Test fehlgeschlagen {ago}: {reason}.',
    es: 'Última prueba fallida {ago}: {reason}.',
  },
  cpuLimited: {
    en: 'The processor of Gladys limited this test: the speeds may be under-estimated.',
    fr: 'Le processeur de Gladys a limité ce test : les débits sont peut-être sous-estimés.',
    de: 'Der Prozessor von Gladys hat diesen Test begrenzt: Die Geschwindigkeiten sind vielleicht zu niedrig.',
    es: 'El procesador de Gladys limitó esta prueba: las velocidades pueden estar subestimadas.',
  },
  addDevice: {
    en: 'Add the Fast.com device (Integrations → Fast.com → Discovery) to keep the history.',
    fr: 'Ajoutez l’appareil Fast.com (Intégrations → Fast.com → Découverte) pour garder l’historique.',
    de: 'Füge das Gerät Fast.com hinzu (Integrationen → Fast.com → Erkennung), um den Verlauf zu behalten.',
    es: 'Añade el dispositivo Fast.com (Integraciones → Fast.com → Descubrimiento) para guardar el historial.',
  },
  buttonRun: { en: 'Run a test', fr: 'Lancer un test', de: 'Test starten', es: 'Iniciar prueba' },
  chartSpeeds: { en: 'Speeds', fr: 'Débits', de: 'Geschwindigkeiten', es: 'Velocidades' },
  chartLatency: { en: 'Latency', fr: 'Latence', de: 'Latenz', es: 'Latencia' },
  unitGB: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
  unitMB: { en: 'MB', fr: 'Mo', de: 'MB', es: 'MB' },

  // relative times
  ago_now: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  ago_minutes: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  ago_hours: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  ago_days: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },
};

/**
 * @description A text in a language, with `{name}` substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('buttonRun', 'fr'); // -> 'Lancer un test'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const text = entry[language] ?? entry.en;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined || values[name] === null ? match : String(values[name]),
  );
}

/**
 * @description A text built per language, at most 200 characters (toasts and
 * connection messages are cut there by Gladys).
 * @param {Function} build - `(language) => string`.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function each(build) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const text = build(language);
      return [language, text.length > 200 ? `${text.slice(0, 199)}…` : text];
    }),
  );
}

/**
 * @description The text of a key in every language.
 * @param {string} key - The TEXTS key.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function all(key, values = {}) {
  return each((language) => t(key, language, values));
}

/**
 * @description A number in the format of a language ("923.6" / "923,6").
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [digits] - Fraction digits at most.
 * @returns {string} The text.
 * @example
 * formatNumber(923.6, 'fr'); // -> '923,6'
 */
function formatNumber(value, language, digits = 1) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);
}

/**
 * @description An amount of data ("1,3 Go", "84 MB").
 * @param {number} megabytes - The amount, in MB.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function formatData(megabytes, language) {
  return megabytes >= 1000
    ? `${formatNumber(megabytes / 1000, language)} ${t('unitGB', language)}`
    : `${formatNumber(megabytes, language, 0)} ${t('unitMB', language)}`;
}

/**
 * @description "12 min ago" for an instant.
 * @param {number} instant - The instant, in ms.
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The relative time.
 */
function ago(instant, now, language) {
  const minutes = Math.max(0, Math.floor((now - instant) / 60000));
  if (minutes < 1) {
    return t('ago_now', language);
  }
  if (minutes < 120) {
    return t('ago_minutes', language, { n: minutes });
  }
  if (minutes < 48 * 60) {
    return t('ago_hours', language, { n: Math.floor(minutes / 60) });
  }
  return t('ago_days', language, { n: Math.floor(minutes / 1440) });
}

/**
 * @description The local time of an instant ("17:00"), with the weekday when
 * it is not today ("Sun 03:00").
 * @param {number} instant - The instant, in ms.
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @param {string} [timeZone] - The time zone (default: the system one).
 * @returns {string} The time.
 */
function clockTime(instant, now, language, timeZone) {
  const zone = timeZone ? { timeZone } : {};
  const day = (value) =>
    new Intl.DateTimeFormat('en-CA', { ...zone, dateStyle: 'short' }).format(value);
  const time = new Intl.DateTimeFormat(language, {
    ...zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
  if (day(instant) === day(now)) {
    return time;
  }
  const weekday = new Intl.DateTimeFormat(language, { ...zone, weekday: 'short' }).format(instant);
  return `${weekday} ${time}`;
}

export { LANGUAGES, TEXTS, t, all, each, formatNumber, formatData, ago, clockTime };
