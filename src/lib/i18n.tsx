"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export type AppLanguage = "en" | "es";

const STORAGE_KEY = "my-fantasy-xi-language";

const spanish: Record<string, string> = {
  "nav.primary": "Navegación principal",
  "nav.home": "Inicio",
  "nav.matchup": "Enfrentamiento",
  "nav.team": "Mi equipo",
  "nav.players": "Jugadores",
  "nav.league": "Liga",
  "nav.footer": "CREA · DIRIGE · COMPITE",
  "shell.LIVE DRAFT": "DRAFT EN VIVO",
  "shell.LIVE AUCTION": "SUBASTA EN VIVO",
  "shell.MATCHUP": "ENFRENTAMIENTO",
  "shell.MY TEAM": "MI EQUIPO",
  "shell.PLAYERS": "JUGADORES",
  "shell.LEAGUE": "LIGA",
  "shell.WAIVERS": "FICHAJES",
  "shell.TRADES": "INTERCAMBIOS",
  "shell.Draft room": "Sala del draft",
  "shell.Auction room": "Sala de subasta",
  "shell.Head to head": "Cara a cara",
  "shell.My team": "Mi equipo",
  "shell.Player market": "Mercado de jugadores",
  "shell.Trade center": "Centro de intercambios",
  "shell.Select a league": "Selecciona una liga",
  "home.realFootball": "FÚTBOL REAL · HOY",
  "home.todaysMatches": "Partidos de hoy",
  "home.live": "EN VIVO",
  "home.final": "FINAL",
  "home.scheduled": "PROGRAMADO",
  "home.noMatches": "No hay partidos programados para hoy.",
  "account.open": "Abrir configuración personal",
  "account.settings": "CONFIGURACIÓN PERSONAL",
  "account.profile": "Tu perfil",
  "account.activeLeague": "Liga activa",
  "account.activeLeagueHelp": "Cambia la liga que se usa en todas las páginas.",
  "account.photo": "Foto de perfil",
  "account.photoHelp": "Toca la imagen para elegir una foto.",
  "account.displayName": "Nombre visible",
  "account.email": "Correo electrónico",
  "account.account": "CUENTA",
  "account.appearance": "Apariencia",
  "account.auto": "Automático",
  "account.light": "Claro",
  "account.dark": "Oscuro",
  "account.language": "Idioma",
  "account.languageHelp": "Se guarda en tu cuenta y se usa en todos tus dispositivos.",
  "account.notifications": "Notificaciones",
  "account.notificationsHelp": "Actividad de la liga y recordatorios importantes.",
  "account.save": "Guardar perfil",
  "account.saving": "Guardando…",
  "account.saved": "Perfil guardado.",
  "account.appearanceSaved": "Apariencia guardada.",
  "account.developer": "Abrir herramientas de desarrollador",
  "account.signOut": "Cerrar sesión",
  "account.photoReady": "Foto lista. Guarda tu perfil para conservarla.",
  "account.photoSize": "Elige una imagen de menos de 3 MB.",
  "format.auction": "Subasta",
  "format.pack": "Sobres",
  "format.snake": "Draft serpiente",
  "auth.hero": "Cada decisión\ndefine tu temporada.",
  "auth.welcomeManager": "BIENVENIDO, MÁNAGER",
  "auth.welcomeBack": "BIENVENIDO DE NUEVO",
  "auth.createTitle": "Crea tu cuenta.",
  "auth.loginTitle": "Entra a tu club.",
  "auth.createCopy": "Únete a una liga, arma tu plantilla y empieza a competir.",
  "auth.loginCopy": "Tus ligas, alineaciones y enfrentamientos te esperan.",
  "auth.action": "Acción de cuenta",
  "auth.create": "Crear cuenta",
  "auth.login": "Iniciar sesión",
  "auth.managerName": "Nombre del mánager",
  "auth.email": "Correo electrónico",
  "auth.password": "Contraseña",
  "auth.betaCode": "Código de acceso beta",
  "auth.inviteOnly": "My Fantasy XI actualmente funciona solo por invitación.",
  "auth.working": "Procesando…",
  "auth.note": "Al continuar, aceptas usar My Fantasy XI de manera responsable y mantener segura tu cuenta.",
  "auth.preview": "Modo de vista previa: Supabase no está configurado.",
  "auth.createError": "No se pudo crear tu cuenta.",
  "chat.live": "CHAT EN VIVO",
  "chat.roomDraft": "Sala del draft",
  "chat.roomAuction": "Sala de la subasta",
  "chat.close": "Cerrar chat",
  "chat.you": "Tú",
  "chat.manager": "Mánager",
  "chat.empty": "La sala está en silencio. Inicia la conversación.",
  "chat.placeholder": "Mensaje para la liga…",
  "chat.message": "Mensaje del chat",
  "chat.send": "Enviar",
  "chat.openDraft": "Abrir chat de la sala del draft",
  "chat.openAuction": "Abrir chat de la sala de la subasta",
  "chat.unread": "mensajes sin leer",
  "chat.label": "Chat",
  "legal.beta": "BETA CERRADA",
  "legal.title": "Aviso de cuenta beta",
  "legal.intro": "Revisa estos puntos esenciales antes de entrar a tu panel.",
  "legal.privacyTitle": "Tu privacidad",
  "legal.privacy": "Respetamos tu privacidad. No vendemos tu información personal ni la compartimos con terceros con fines de publicidad o marketing. La información necesaria para operar My Fantasy XI puede ser procesada por proveedores de confianza que nos ayudan con servicios como autenticación, base de datos y alojamiento.",
  "legal.dataTitle": "Datos de fantasy y errores",
  "legal.data": "My Fantasy XI utiliza estadísticas deportivas y otra información de fuentes de datos externas. Aunque trabajamos para mantener la información correcta, los datos de jugadores, puntos, estadísticas, rankings, disponibilidad, información de partidos y resultados de fantasy pueden contener errores, retrasos o correcciones. Nos reservamos el derecho de corregir datos o puntuaciones inexactas cuando sea necesario.",
  "legal.trademarkTitle": "Marcas y contenido de terceros",
  "legal.trademark": "Los nombres de clubes, ligas, competiciones y jugadores, así como logotipos, marcas y demás propiedad intelectual de terceros, pertenecen a sus respectivos propietarios. Su aparición en My Fantasy XI no implica propiedad, patrocinio ni respaldo de esas partes.",
  "legal.independentTitle": "Plataforma fantasy independiente",
  "legal.independent": "My Fantasy XI es una plataforma independiente de fantasy deportivo. No está afiliada, patrocinada ni respaldada por FIFA, UEFA, ninguna liga nacional, club, jugador, organismo rector u otra organización mencionada en la plataforma.",
  "legal.agree": "He leído y acepto el Aviso de Cuenta Beta de My Fantasy XI.",
  "legal.continue": "Continuar",
  "legal.saving": "Guardando…",
  "legal.verifyError": "No pudimos verificar el aviso de tu cuenta. Actualiza la página e inténtalo de nuevo.",
  "legal.saveError": "No se pudo guardar tu aceptación. Inténtalo de nuevo.",
  "beta.title": "Esta cuenta necesita acceso beta.",
  "beta.copy": "My Fantasy XI actualmente funciona solo por invitación. Crea una cuenta aprobada usando un código de acceso beta válido.",
  "beta.return": "Volver al inicio de sesión",
};

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: string, fallback?: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function browserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "en";
  return navigator.languages?.some((item) => item.toLowerCase().startsWith("es")) ||
    navigator.language.toLowerCase().startsWith("es")
    ? "es"
    : "en";
}

function applyLanguage(language: AppLanguage) {
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setCurrentLanguage] = useState<AppLanguage>("en");

  useEffect(() => {
    let active = true;
    async function load() {
      const local = window.localStorage.getItem(STORAGE_KEY);
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      const account = user?.user_metadata?.language_preference;
      const next: AppLanguage = account === "es" || account === "en"
        ? account
        : local === "es" || local === "en"
          ? local
          : browserLanguage();
      setCurrentLanguage(next);
      window.localStorage.setItem(STORAGE_KEY, next);
      applyLanguage(next);
    }
    void load();
    return () => { active = false; };
  }, []);

  async function setLanguage(language: AppLanguage) {
    setCurrentLanguage(language);
    window.localStorage.setItem(STORAGE_KEY, language);
    applyLanguage(language);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.auth.updateUser({ data: { language_preference: language } });
  }

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key, fallback) => language === "es" ? (spanish[key] ?? fallback ?? key) : (fallback ?? key),
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
