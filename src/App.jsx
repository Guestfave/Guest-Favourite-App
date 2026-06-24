import { useState, useMemo, useEffect, useCallback } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const SUPABASE_URL  = "https://cjrcjvsiemzfzncgugzh.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcmNqdnNpZW16ZnpuY2d1Z3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDc4NTYsImV4cCI6MjA5NzEyMzg1Nn0.6l6GYB7S2gNmV61E7CkePPQvfZ6bLeZnCZHWA1yetNA";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);


// ─── GUESTFAVOURITE BRAND TOKENS ─────────────────────────────────────────────
// Sourced from brand guidelines (SJW Studios, 2024) + guestfavourite.co.uk
const B = {
  pink:       "#E61C5D",   // Primary — always the hero
  pinkDark:   "#C01550",   // Hover/pressed state
  pinkLight:  "#FFE8F0",   // Tinted backgrounds
  black:      "#0D0D0D",   // Near-black (header, strong text)
  charcoal:   "#1A1A1A",   // Secondary dark
  gold:       "#F3C669",   // Accent — use sparingly
  white:      "#FFFFFF",
  offWhite:   "#F7F7F7",   // Page background
  slate:      "#64748b",   // Muted text
  border:     "#E8E8E8",   // Subtle borders
};
// Inject Barlow font (brand typeface)
if (typeof document !== "undefined" && !document.getElementById("gf-font")) {
  const l = document.createElement("link");
  l.id   = "gf-font";
  l.rel  = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800;900&display=swap";
  document.head.appendChild(l);
}
// Ensure mobile viewport is set correctly
if (typeof document !== "undefined") {
  let vp = document.querySelector("meta[name=viewport]");
  if (!vp) { vp = document.createElement("meta"); vp.name = "viewport"; document.head.appendChild(vp); }
  vp.content = "width=device-width, initial-scale=1, maximum-scale=1";
}

// ─── PROPERTY CONFIG ─────────────────────────────────────────────────────────
// model: "split"  -> CoHost Comm = Booking Payout x cohost%   (CH, 70W)
// model: "tiered" -> CoHost Comm = (True Net - Business Comm) x cohost%   (44a, 65a, TM)
const DEFAULT_PROPERTIES = {
  "70 W": { sholom: 0.13, cohost: 0.035, cohostName: "Hayley",  model: "split",  live: true },
  "CH":   { sholom: 0.16, cohost: 0.035, cohostName: "Hayley",  model: "split",  live: true },
  "44a":  { sholom: 0.20, cohost: 0.10,  cohostName: "Hayley",  model: "tiered", live: true },
  "65a":  { sholom: 0.20, cohost: 0.10,  cohostName: "Hayley",  model: "tiered", live: true },
  "TM":   { sholom: 0.16, cohost: 0,     cohostName: "Rebecca", model: "tiered", live: false },
};

// ─── PLATFORM CONFIG ─────────────────────────────────────────────────────────
// AirBNB:      base = fullGross / (1 + 16.94%); guest fee + host fee (3% x VAT) both come off base
// Booking.com: guestServiceFee = fullGross x 16.60% (direct); bookingPayout = fullGross - guestServiceFee; no host fee
// Website:     nightlyRate = (fullGross - cleaningFee) / 1.06; guestServiceFee = nightlyRate x 6%
//              bookingPayout = fullGross - guestServiceFee (= nightlyRate + cleaningFee)
//              channelServiceFee = fullGross x 0.5%, deducted at the True Net stage (charged to owner)
// VRBO:        guestServiceFee = fullGross x 15% (direct); bookingPayout = fullGross - guestServiceFee
//              nightlyRate = (fullGross - cleaningFee) / 1.06
//              channelServiceFee = nightlyRate x 6%, deducted at the True Net stage (charged to owner)
const PLATFORMS = {
  AirBNB:  { type: "divide",  guestFee: 0.1694, hostFee: 0.03,  vat: 1.20, hostFeeLabel: "Host Service Fee" },
  Booking: { type: "direct",  guestFee: 0.1660, hostFee: 0,     vat: 1.00, hostFeeLabel: "Host Service Fee" },
  Website: { type: "website", guestFee: 0.06,   hostFee: 0.005, vat: 1.00, hostFeeLabel: "Channel Service Fee" },
  VRBO:    { type: "vrbo",    guestFee: 0.15,   hostFee: 0.06,  vat: 1.00, hostFeeLabel: "Channel Service Fee" },
};
const PLATFORM_NAMES = Object.keys(PLATFORMS);

const EXPENSE_CATEGORIES = ["Maintenance", "Callout", "CoHost Callout", "Hamper", "Replenishables", "Other"];

// ─── ROLE-BASED ACCESS ───────────────────────────────────────────────────────
// CHANGE THESE PINS to whatever you like:
const ROLE_PINS = {
  owner:  "1234",   // full access — change this!
  cohost: "5678",   // Hayley / Rebecca — change this!
};
// Per-property client PINs — change these!
const CLIENT_PINS = {
  "70 W": "2001",
  "CH":   "2002",
  "44a":  "2003",
  "65a":  "2004",
  "TM":   "2005",
};
const ROLE_LABELS = { owner: "Owner", cohost: "CoHost", client: "Client" };
// Fields hidden from the CoHost role across the table, calc preview, and invoice
const COHOST_HIDDEN_FIELDS = ["trueNet", "businessComm", "businessProfit"];

// Returns human-readable fee-basis labels for the CalcPreview / Invoice views
function feeBasisLabels(plat) {
  switch (plat.type) {
    case "divide": // AirBNB
      return {
        guest: `Guest Service Fee ${(plat.guestFee*100).toFixed(2)}% of Base`,
        host:  plat.hostFee > 0 ? `Host Service Fee ${(plat.hostFee*100).toFixed(0)}%+VAT of Base` : `${plat.hostFeeLabel} (none)`,
      };
    case "direct": // Booking.com
      return {
        guest: `Guest Service Fee ${(plat.guestFee*100).toFixed(2)}% of Gross`,
        host:  plat.hostFee > 0 ? `${plat.hostFeeLabel} ${(plat.hostFee*100).toFixed(2)}% of Gross` : `${plat.hostFeeLabel} (none)`,
      };
    case "website":
      return {
        guest: `Guest Service Fee ${(plat.guestFee*100).toFixed(2)}% of Nightly Rate`,
        host:  `${plat.hostFeeLabel} ${(plat.hostFee*100).toFixed(2)}% of Gross`,
      };
    case "vrbo":
      return {
        guest: `Guest Service Fee ${(plat.guestFee*100).toFixed(2)}% of Gross`,
        host:  `${plat.hostFeeLabel} ${(plat.hostFee*100).toFixed(2)}% of Nightly Rate`,
      };
    default:
      return { guest: "Guest Service Fee", host: plat.hostFeeLabel || "Host Service Fee" };
  }
}

// ─── CALCULATION ENGINE ──────────────────────────────────────────────────────
// Verified against:
//  - CC00001 (CH)  -> ownerPayout 772.31, businessComm 147.11, cohostComm 47.40, businessProfit 109.71 (AirBNB)
//  - CC00002 (70W) -> businessComm 379.89, cohostComm 119.78, businessProfit 280.11 (AirBNB)
//  - CC00013 (70W) -> guestServiceFee 710.14, bookingPayout 3567.80, businessComm 398.81, cohostComm 124.87 (Booking.com)
//  - Fresh example -> fullGross 5129.48, cleaningFee 510, nightlyRate 4358.00 (exact),
//                      guestServiceFee 261.48 = nightlyRate x 6% (exact), bookingPayout 4868.00 (Website)
//  - VRBO example -> fullGross 373.82, cleaningFee 153, nightlyRate 208.32 (exact),
//                     guestServiceFee 56.07 = fullGross x 15% (exact),
//                     channelServiceFee 12.50 = nightlyRate x 6% (exact)
//                     -> for 65a: businessComm 30.45, cohostComm 12.18, ownerPayout 121.80, businessProfit 18.27
//
// AirBNB ("divide"):
//   base            = fullGross / (1 + 16.94%)
//   guestServiceFee = base x 16.94%
//   hostServiceFee  = base x 3% x 1.20 (VAT)
//   bookingPayout   = base - hostServiceFee
//
// Booking.com ("direct", hostFee=0):
//   guestServiceFee = fullGross x 16.60%
//   hostServiceFee  = 0
//   bookingPayout   = fullGross - guestServiceFee
//   base            = bookingPayout
//
// Website ("website"):
//   nightlyRate       = (fullGross - cleaningFee) / 1.06
//   guestServiceFee   = nightlyRate x 6%
//   bookingPayout     = fullGross - guestServiceFee   (= nightlyRate + cleaningFee)
//   channelServiceFee (stored as hostServiceFee) = fullGross x 0.5%
//     -> NOT part of bookingPayout; deducted at the True Net stage instead
//        (it's charged to the OWNER directly from the booking)
//   base              = bookingPayout
//
// VRBO ("vrbo"):
//   guestServiceFee   = fullGross x 15% (direct)
//   bookingPayout     = fullGross - guestServiceFee
//   nightlyRate       = (fullGross - cleaningFee) / 1.06
//   channelServiceFee (stored as hostServiceFee) = nightlyRate x 6%
//     -> NOT part of bookingPayout; deducted at the True Net stage instead
//        (it's charged to the OWNER directly from the booking, same as Website)
//   base              = nightlyRate + cleaningFee
//
// trueNet         = bookingPayout - cleaningFee - laundryFees - spaFeeCharge - (Website/VRBO: channelServiceFee)
// businessComm    = trueNet x sholom%
// cohostComm      = "split"  -> bookingPayout x cohost%
//                    "tiered" -> (trueNet - businessComm) x cohost%
//
// ownerPayout     = trueNet - businessComm - coHostCalloutCharge
//                   (owner is charged the CHARGE amounts, never the COST amounts;
//                    cohostComm is paid OUT of business profit, not by the owner;
//                    mistakes do NOT affect the client's payout)
//
// businessProfit  = businessComm - cohostComm
//                    + (spaFeeCharge - spaFeeCost)
//                    + (coHostCalloutCharge - coHostCalloutCost)
//                    - mistakes

function calcBooking(b, propertiesMap) {
  const PROPS = propertiesMap || DEFAULT_PROPERTIES;
  const fg   = parseFloat(b.fullGross)           || 0;
  const cf   = parseFloat(b.cleaningFee)         || 0;
  const lf   = parseFloat(b.laundryFees)         || 0;
  const spaC = parseFloat(b.spaFeeCost)          || 0;
  const spaQ = parseFloat(b.spaFeeCharge)        || 0;
  const chC  = parseFloat(b.coHostCalloutCost)   || 0;
  const chQ  = parseFloat(b.coHostCalloutCharge) || 0;
  const mis  = parseFloat(b.mistakes)            || 0;

  const platform = PLATFORMS[b.platform] || PLATFORMS["AirBNB"];

  let base, guestServiceFee, hostServiceFee, bookingPayout;
  if (platform.type === "website") {
    // Website: guest fee is 6% of the Nightly Rate, where
    // Nightly Rate = (Full Gross - Cleaning Fee) / 1.06
    const nightlyRate = (fg - cf) / (1 + platform.guestFee);
    guestServiceFee   = nightlyRate * platform.guestFee;
    bookingPayout      = fg - guestServiceFee;          // = nightlyRate + cleaningFee
    hostServiceFee     = fg * platform.hostFee;          // channel fee, 0.5% of Full Gross
    base               = bookingPayout;
  } else if (platform.type === "vrbo") {
    // VRBO: guest fee is a direct 15% of Full Gross
    // Channel fee is 6% of Nightly Rate, where Nightly Rate = (Full Gross - Cleaning Fee) / 1.06
    const nightlyRate = (fg - cf) / (1 + platform.hostFee);
    guestServiceFee   = fg * platform.guestFee;
    hostServiceFee    = nightlyRate * platform.hostFee;
    bookingPayout     = fg - guestServiceFee;
    base              = nightlyRate + cf;
  } else if (platform.type === "direct") {
    // Booking.com: guest fee is a direct % of Full Gross, no host fee
    guestServiceFee = fg * platform.guestFee;
    hostServiceFee  = fg * platform.hostFee;
    bookingPayout   = fg - guestServiceFee - hostServiceFee;
    base            = bookingPayout;
  } else {
    // AirBNB: base is "grossed down" from Full Gross, then host fee comes off base
    base            = fg / (1 + platform.guestFee);
    guestServiceFee = base * platform.guestFee;
    hostServiceFee  = base * platform.hostFee * platform.vat;
    bookingPayout   = base - hostServiceFee;
  }

  // For Website and VRBO, the Channel Service Fee is charged to the OWNER separately,
  // so it comes off at the True Net stage (not already reflected in bookingPayout)
  const channelFeeAtTrueNet = (platform.type === "website" || platform.type === "vrbo") ? hostServiceFee : 0;
  const trueNet = bookingPayout - cf - lf - spaQ - channelFeeAtTrueNet;

  const prop = PROPS[b.property] || Object.values(PROPS)[0] || { sholom: 0.16, cohost: 0.035, cohostName: "", model: "tiered", live: false };

  const businessComm = trueNet * prop.sholom;

  const cohostComm = prop.model === "tiered"
    ? (trueNet - businessComm) * prop.cohost   // 44a / 65a / TM
    : bookingPayout * prop.cohost;             // CH / 70W

  const ownerPayout = trueNet - businessComm - chQ;

  const businessProfit = businessComm - cohostComm + (spaQ - spaC) + (chQ - chC) - mis;

  return {
    ...b,
    fullGross:       +fg.toFixed(2),
    coHostCalloutCost: +chC.toFixed(2),
    base:            +base.toFixed(2),
    guestServiceFee: +guestServiceFee.toFixed(2),
    hostServiceFee:  +hostServiceFee.toFixed(2),
    bookingPayout:   +bookingPayout.toFixed(2),
    trueNet:         +trueNet.toFixed(2),
    businessComm:    +businessComm.toFixed(2),
    cohostComm:      +cohostComm.toFixed(2),
    ownerPayout:     +ownerPayout.toFixed(2),
    businessProfit:  +businessProfit.toFixed(2),
  };
}

const fmt    = n => `£${Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum    = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);
const nextId = bs => `CC${String(bs.length + 1).padStart(5, "0")}`;
// Parse a "DD/MM/YYYY" date string into a sortable number (YYYYMMDD). Invalid/empty -> 0.
const parseDMY = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || "").trim());
  if (!m) return 0;
  return parseInt(m[3], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10);
};

const EMPTY = {
  property: "CH", guestName: "", bookingId: "", platform: "AirBNB",
  startDate: "", endDate: "", fullGross: "", cleaningFee: "", laundryFees: "",
  spaFeeCost: "", spaFeeCharge: "", coHostCalloutCost: "", coHostCalloutCharge: "", mistakes: "",
};

const propColor = p => ({ "70 W": "#0ea5e9", CH: "#8b5cf6", "44a": "#f59e0b", "65a": "#10b981", TM: "#ec4899" }[p] || "#6b7280");

function Tag({ label, color }) {
  return <span style={{ background: color + "18", color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{label}</span>;
}

function Field({ label, field, form, setForm, type = "text", step }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 700, color: "#999999", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      <input
        type={type} step={step} value={form[field] ?? ""}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        style={{ padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, background: "#FFFFFF", outline: "none", fontFamily: "inherit" }}
      />
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [mode, setMode]           = useState("login"); // "login" | "reset" | "set-password"
  const [resetSent, setResetSent] = useState(false);

  // On mount — check if URL hash contains a recovery token (from password reset email)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("type=recovery") && hash.includes("access_token")) {
      // Parse the token from the hash and set the session
      sb.auth.getSession().then(({ data: { session } }) => {
        if (session) setMode("set-password");
      });
      // Also try exchanging the hash directly
      sb.auth.exchangeCodeForSession(window.location.search).catch(() => {});
      setMode("set-password");
    }
    if (hash && hash.includes("type=invite") && hash.includes("access_token")) {
      setMode("set-password");
    }
  }, []);

  async function handleLogin(e) {
    e && e.preventDefault();
    if (!email || !password) return;
    setLoading(true); setError("");
    const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    const { data: profile } = await sb.from("profiles").select("*").eq("id", data.user.id).single();
    if (!profile) { setError("Account not set up yet — contact your administrator."); setLoading(false); return; }
    if (!profile.active) { setError("Your account has been deactivated."); await sb.auth.signOut(); setLoading(false); return; }
    onLogin(data.user, profile);
    setLoading(false);
  }

  async function handleSetPassword(e) {
    e && e.preventDefault();
    if (!newPassword) return;
    if (newPassword !== confirmPassword) { setError("Passwords don't match"); return; }
    if (newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    const { error: err } = await sb.auth.updateUser({ password: newPassword });
    if (err) { setError(err.message); setLoading(false); return; }
    // Now sign in automatically
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const { data: profile } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
      if (profile) { onLogin(session.user, profile); return; }
    }
    // If no session, redirect to login
    window.location.hash = "";
    setMode("login");
    setError("");
    setLoading(false);
  }

  async function handleReset() {
    if (!email) { setError("Enter your email address first"); return; }
    setLoading(true);
    const { error: err } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (err) { setError(err.message); } else { setResetSent(true); }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0D0D0D", fontFamily: "'Barlow', -apple-system, sans-serif" }}>
      <div style={{ background: "#FFFFFF", borderRadius: 24, padding: "40px 36px", width: 360, maxWidth: "90vw", boxShadow: "0 24px 80px rgba(0,0,0,0.4)" }}>
        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
            <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 900, fontSize: 28, color: "#0D0D0D", letterSpacing: "-0.5px" }}>GuestFavour</span>
            <span style={{ position: "relative", fontFamily: "'Barlow', sans-serif", fontWeight: 900, fontSize: 28, color: "#0D0D0D", letterSpacing: "-0.5px", display: "inline-block" }}>
              ı
              <span style={{ position: "absolute", top: "18%", left: "50%", transform: "translateX(-50%)", width: 6, height: 6, borderRadius: "50%", background: "#E61C5D", display: "block" }}/>
            </span>
            <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 900, fontSize: 28, color: "#0D0D0D", letterSpacing: "-0.5px" }}>te</span>
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 4, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Property Management</div>
        </div>

        <div style={{ marginTop: 28 }}>
          {mode === "set-password" ? (
            <form onSubmit={handleSetPassword} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Set your password</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>Choose a password to secure your account</div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>New Password</label>
              <input type="password" value={newPassword} onChange={e => { setNewPassword(e.target.value); setError(""); }}
                placeholder="At least 6 characters" autoFocus
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 14, marginBottom: 14, boxSizing: "border-box", outline: "none" }} />
              <label style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
                placeholder="Same password again"
                style={{ width: "100%", padding: "11px 14px", border: error ? "1.5px solid #fca5a5" : "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 14, marginBottom: 10, boxSizing: "border-box", outline: "none" }} />
              {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{error}</div>}
              <button type="submit" disabled={loading || !newPassword || !confirmPassword}
                style={{ width: "100%", padding: "13px", borderRadius: 10, border: "none", background: loading || !newPassword || !confirmPassword ? "#E8E8E8" : "#E61C5D", color: loading || !newPassword || !confirmPassword ? "#aaa" : "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 14 }}>
                {loading ? "Setting password…" : "Set Password & Sign In"}
              </button>
            </form>
          ) : resetSent ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📧</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Check your email</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>We've sent a password reset link to {email}</div>
              <button onClick={() => { setResetSent(false); setMode("login"); }} style={{ color: "#E61C5D", background: "none", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Back to login</button>
            </div>
          ) : mode === "reset" ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Reset password</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>Enter your email and we'll send you a reset link</div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="your@email.com" autoFocus
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 14, marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
              {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{error}</div>}
              <button onClick={handleReset} disabled={loading}
                style={{ width: "100%", padding: "13px", borderRadius: 10, border: "none", background: loading ? "#E8E8E8" : "#E61C5D", color: loading ? "#aaa" : "#fff", fontWeight: 700, fontSize: 15, cursor: loading ? "default" : "pointer", marginBottom: 12 }}>
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
              <button onClick={() => { setMode("login"); setError(""); }} style={{ color: "#666", background: "none", border: "none", fontWeight: 600, cursor: "pointer", fontSize: 13, width: "100%" }}>Back to login</button>
            </>
          ) : (
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="your@email.com" autoFocus
                style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 14, marginBottom: 14, boxSizing: "border-box", outline: "none" }} />
              <label style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                style={{ width: "100%", padding: "11px 14px", border: error ? "1.5px solid #fca5a5" : "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 14, marginBottom: 10, boxSizing: "border-box", outline: "none" }} />
              {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{error}</div>}
              <button type="submit" disabled={loading || !email || !password}
                style={{ width: "100%", padding: "13px", borderRadius: 10, border: "none", background: loading || !email || !password ? "#E8E8E8" : "#E61C5D", color: loading || !email || !password ? "#aaa" : "#fff", fontWeight: 700, fontSize: 15, cursor: loading || !email || !password ? "default" : "pointer", marginBottom: 14 }}>
                {loading ? "Signing in…" : "Sign In"}
              </button>
              <button type="button" onClick={() => { setMode("reset"); setError(""); }}
                style={{ color: "#666", background: "none", border: "none", fontWeight: 600, cursor: "pointer", fontSize: 13, textAlign: "center" }}>
                Forgot password?
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ATTACHMENTS COMPONENT ───────────────────────────────────────────────────
// Reusable upload + thumbnail strip for bookings and expenses
function Attachments({ recordType, recordId, authUserId, readOnly }) {
  const [files, setFiles]     = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!recordId) return;
    loadFiles();
  }, [recordId]);

  async function loadFiles() {
    const { data, error } = await sb.from("attachments")
      .select("*").eq("record_type", recordType).eq("record_id", recordId)
      .order("created_at");
    if (!error) setFiles(data || []);
  }

  async function handleUpload(e) {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploading(true); setError(null);
    for (const file of selected) {
      const ext      = file.name.split(".").pop().toLowerCase();
      const isImage  = ["jpg","jpeg","png","gif","webp","heic"].includes(ext);
      const path     = `${recordType}/${recordId}/${Date.now()}-${file.name.replace(/\s+/g,"_")}`;
      const { data: storageData, error: upErr } = await sb.storage.from("attachments").upload(path, file, { upsert: false });
      if (upErr) { setError(upErr.message); continue; }
      const { data: { publicUrl } } = sb.storage.from("attachments").getPublicUrl(path);
      await sb.from("attachments").insert({
        record_type: recordType, record_id: recordId,
        file_name: file.name, file_url: publicUrl,
        file_type: isImage ? "image" : "document",
        file_size: file.size, uploaded_by: authUserId,
      });
    }
    await loadFiles();
    setUploading(false);
    e.target.value = "";
  }

  async function handleDelete(att) {
    if (!confirm(`Delete "${att.file_name}"?`)) return;
    // Extract path from URL
    const path = att.file_url.split("/attachments/")[1];
    await sb.storage.from("attachments").remove([path]);
    await sb.from("attachments").delete().eq("id", att.id);
    await loadFiles();
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        Attachments {files.length > 0 && `(${files.length})`}
      </div>

      {/* Thumbnail strip */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {files.map(att => (
            <div key={att.id} style={{ position: "relative", display: "inline-block" }}>
              <a href={att.file_url} target="_blank" rel="noopener noreferrer" title={att.file_name}>
                {att.file_type === "image" ? (
                  <img src={att.file_url} alt={att.file_name}
                    style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1.5px solid #E8E8E8", display: "block" }} />
                ) : (
                  <div style={{ width: 52, height: 52, borderRadius: 8, border: "1.5px solid #E8E8E8", background: "#F9F9F9", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    <span style={{ fontSize: 20 }}>📄</span>
                    <span style={{ fontSize: 8, color: "#999", maxWidth: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                      {att.file_name.split(".").pop().toUpperCase()}
                    </span>
                  </div>
                )}
              </a>
              {!readOnly && (
                <button onClick={() => handleDelete(att)}
                  style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#dc2626", color: "#fff", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {!readOnly && (
        <>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1.5px dashed #E8E8E8", background: "#FAFAFA", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#666" }}>
            {uploading ? "Uploading…" : "+ Add Files"}
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={handleUpload} disabled={uploading}
              style={{ display: "none" }} />
          </label>
          <div style={{ fontSize: 10, color: "#bbb", marginTop: 4 }}>Photos, PDFs, documents — tap to view</div>
          {error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{error}</div>}
        </>
      )}
    </div>
  );
}

function CalcPreview({ form, isCohost }) {
  try {
  const fg = parseFloat(form.fullGross);
  if (!fg) return null;
  const prop = PROPERTIES[form.property] || Object.values(PROPERTIES)[0];
  if (!prop) return null;
  const c    = calcBooking(form, PROPERTIES);
  const cohostBasisLabel = prop.model === "tiered"
    ? `${+(prop.cohost*100).toFixed(1)}% of (True Net − Biz Comm)`
    : `${+(prop.cohost*100).toFixed(1)}% of Booking Payout`;
  const plat = PLATFORMS[form.platform] || PLATFORMS["AirBNB"];
  const feeLabels = feeBasisLabels(plat);
  const rows = [
    ["Base (Nightly + Cleaning)", fmt(c.base),            "#94a3b8", null],
    [feeLabels.guest,  fmt(c.guestServiceFee), "#f87171", null],
    [feeLabels.host,   fmt(c.hostServiceFee),  "#fb923c", null],
    ["Booking Payout",            fmt(c.bookingPayout),   "#60a5fa", null],
    ["True Net",                  fmt(c.trueNet),         "#a78bfa", "trueNet"],
    [`Business Comm ${+(prop.sholom*100).toFixed(0)}% of True Net`, fmt(c.businessComm), "#4ade80", "businessComm"],
    [`CoHost Comm — ${cohostBasisLabel}`, fmt(c.cohostComm), "#f472b6", null],
    ["Client Payout",              fmt(c.ownerPayout),     "#34d399", null],
    ["Business Profit",           fmt(c.businessProfit),  "#facc15", "businessProfit"],
  ].filter(r => !(isCohost && COHOST_HIDDEN_FIELDS.includes(r[3])));
  return (
    <div style={{ marginTop: 16, background: "#0D0D0D", borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#555555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Live Preview</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {rows.map(([l, v, col]) => (
          <div key={l} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: "#666666", marginBottom: 3 }}>{l}</div>
            <div style={{ fontWeight: 700, color: col, fontSize: 14 }}>{v}</div>
          </div>
        ))}
      </div>
      {!isCohost && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#666666" }}>
          Owner pays the <strong style={{ color: "#fbbf24" }}>charge</strong> amounts (spa/cohost), never the cost. The cost/charge difference is business profit.
        </div>
      )}
    </div>
  );
  } catch(err) { return null; }
}

export default function App() {
  // ── Auth state ──────────────────────────────────────────────────────────────
  const [authUser, setAuthUser]       = useState(null);
  const [profile, setProfile]         = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [users, setUsers]             = useState([]);

  // ── Data state ───────────────────────────────────────────────────────────────
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES);
  const PROPERTIES     = properties;
  const PROPERTY_NAMES = Object.keys(properties);
  const [bookings, setBookings] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [dbError, setDbError]   = useState(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [tab, setTab]           = useState("bookings");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(EMPTY);
  const [editId, setEditId]     = useState(null);
  const [filterProp, setFilterProp] = useState("All");
  const [search, setSearch]     = useState("");
  const [invoice, setInvoice]   = useState(null);
  const [emailTo, setEmailTo]   = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [dashProp, setDashProp]   = useState("All");
  const [dashMonth, setDashMonth] = useState("All");
  const [dashYear, setDashYear]   = useState("All");
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ property: "CH", description: "", amount: "", charge: "", expenseType: "business", category: "Maintenance", date: "", bookingLink: "last", bookingId: "" });
  const [showIssues, setShowIssues] = useState(true);
  const [resolveExpenseId, setResolveExpenseId] = useState(null);
  const [resolveChargeInput, setResolveChargeInput] = useState("");
  const [expFilterProp, setExpFilterProp]     = useState("All");
  const [expFilterCat, setExpFilterCat]       = useState("All");
  const [expFilterType, setExpFilterType]     = useState("All");
  const [expFilterMonth, setExpFilterMonth]   = useState("All");
  const [expFilterYear, setExpFilterYear]     = useState("All");
  const [showUserModal, setShowUserModal]     = useState(false);
  const [userForm, setUserForm]               = useState({ name: "", email: "", role: "client", properties: [] });
  const [editUserId, setEditUserId]           = useState(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [editPropertyName, setEditPropertyName]   = useState(null);
  const [propertyForm, setPropertyForm]           = useState({ name: "", sholom: "", cohost: "", cohostName: "", model: "tiered", live: false });
  const [impersonating, setImpersonating]         = useState(null);
  const [settingsTab, setSettingsTab]             = useState("users");

  // Derived role values — respect impersonation
  const role           = profile?.role || null;
  const clientProperty = profile?.role === "client" ? (profile.properties?.[0] || null) : null;
  const activeRole     = impersonating ? impersonating.role : role;
  const activeProperty = impersonating ? impersonating.clientProperty : clientProperty;
  const isCohost = activeRole === "cohost";
  const isClient = activeRole === "client";

  // Responsive
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  useEffect(() => {
    const handler = () => { setIsMobile(window.innerWidth < 768); setShowMobileMenu(false); };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Supabase auth session check ───────────────────────────────────────────────
  useEffect(() => {
    sb.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data: prof } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
        setAuthUser(session.user);
        setProfile(prof);
      }
      setAuthLoading(false);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") { setAuthUser(null); setProfile(null); setBookings([]); setExpenses([]); setUsers([]); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Data loaders ──────────────────────────────────────────────────────────────
  function dbToBooking(r) {
    return { id: r.id, property: r.property, platform: r.platform, guestName: r.guest_name, bookingId: r.booking_ref, startDate: r.start_date, endDate: r.end_date, fullGross: r.full_gross, cleaningFee: r.cleaning_fee, laundryFees: r.laundry_fees, mistakes: r.mistakes, spaFeeCost: r.spa_fee_cost, spaFeeCharge: r.spa_fee_charge, coHostCalloutCost: r.co_host_callout_cost, coHostCalloutCharge: r.co_host_callout_charge };
  }
  function bookingToDb(b) {
    return { id: b.id, property: b.property, platform: b.platform, guest_name: b.guestName, booking_ref: b.bookingId||"", start_date: b.startDate||"", end_date: b.endDate||"", full_gross: +b.fullGross||0, cleaning_fee: +b.cleaningFee||0, laundry_fees: +b.laundryFees||0, mistakes: +b.mistakes||0, spa_fee_cost: +b.spaFeeCost||0, spa_fee_charge: +b.spaFeeCharge||0, co_host_callout_cost: +b.coHostCalloutCost||0, co_host_callout_charge: +b.coHostCalloutCharge||0, updated_at: new Date().toISOString() };
  }
  function dbToExpense(r) {
    return { id: r.id, property: r.property, description: r.description, amount: +r.amount, charge: r.charge!=null?+r.charge:null, category: r.category, expenseType: r.expense_type||"", bookingId: r.booking_id, date: r.expense_date, resolved: r.resolved };
  }
  function expenseToDb(e) {
    return { id: e.id, property: e.property, description: e.description, amount: e.amount, charge: e.charge, category: e.category, expense_type: e.expenseType||"", booking_id: e.bookingId||null, expense_date: e.date||"", resolved: e.resolved||false };
  }

  async function loadProperties() {
    const { data, error } = await sb.from("properties").select("*");
    if (error) { setDbError(error.message); return; }
    const obj = {};
    data.forEach(p => { obj[p.code] = { sholom: +p.sholom, cohost: +p.cohost, cohostName: p.cohost_name, model: p.model, live: p.live }; });
    setProperties(obj);
  }
  async function loadBookings(prof) {
    const p = prof || profile;
    if (!p) return;
    let q = sb.from("bookings").select("*").order("created_at", { ascending: false });
    if ((p.role==="cohost"||p.role==="client") && p.properties?.length) q = q.in("property", p.properties);
    const { data, error } = await q;
    if (error) { setDbError(error.message); return; }
    setBookings(data.map(dbToBooking));
  }
  async function loadExpenses(prof) {
    const p = prof || profile;
    if (!p) return;
    let q = sb.from("expenses").select("*").order("created_at", { ascending: false });
    if ((p.role==="cohost"||p.role==="client") && p.properties?.length) q = q.in("property", p.properties);
    const { data, error } = await q;
    if (error) { setDbError(error.message); return; }
    setExpenses(data.map(dbToExpense));
  }
  async function loadUsers() {
    const { data, error } = await sb.from("profiles").select("*").order("created_at");
    if (!error) setUsers(data || []);
  }

  // Track which record IDs have attachments — { "CC00001": 2, "EXP0001": 1, ... }
  const [attachmentCounts, setAttachmentCounts] = useState({});
  async function loadAttachmentCounts() {
    const { data } = await sb.from("attachments").select("record_id");
    if (!data) return;
    const counts = {};
    data.forEach(a => { counts[a.record_id] = (counts[a.record_id] || 0) + 1; });
    setAttachmentCounts(counts);
  }

  useEffect(() => {
    if (!profile) return;
    loadProperties();
    loadBookings(profile);
    loadExpenses(profile);
    loadAttachmentCounts();
    if (profile.role === "owner") loadUsers();
  }, [profile?.id]);

  // Real-time sync
  useEffect(() => {
    if (!profile) return;
    const bSub = sb.channel("rt-bookings").on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>loadBookings()).subscribe();
    const eSub = sb.channel("rt-expenses").on("postgres_changes",{event:"*",schema:"public",table:"expenses"},()=>loadExpenses()).subscribe();
    const aSub = sb.channel("rt-attachments").on("postgres_changes",{event:"*",schema:"public",table:"attachments"},()=>loadAttachmentCounts()).subscribe();
    const pSub = sb.channel("rt-properties").on("postgres_changes",{event:"*",schema:"public",table:"properties"},()=>loadProperties()).subscribe();
    const uSub = sb.channel("rt-profiles").on("postgres_changes",{event:"*",schema:"public",table:"profiles"},()=>{ if(profile.role==="owner") loadUsers(); }).subscribe();
    return () => { [bSub,eSub,pSub,uSub,aSub].forEach(s=>sb.removeChannel(s)); };
  }, [profile?.id]);

  const calc = useMemo(() => {
    return bookings.map(b => {
      try {
        const c = calcBooking(b, properties);
        const linked = expenses.filter(e => e.bookingId === b.id && e.expenseType);
        if (!linked.length) return c;
        const bizCost   = sum(linked.filter(e => e.expenseType === "business"), "amount");
        const ownerCost = sum(linked.filter(e => e.expenseType === "owner"),    "amount");
        return {
          ...c,
          businessProfit: +(c.businessProfit - bizCost).toFixed(2),
          ownerPayout:    +(c.ownerPayout    - ownerCost).toFixed(2),
        };
      } catch(err) {
        console.error("calcBooking error for booking", b.id, err);
        return { ...b, base: 0, guestServiceFee: 0, hostServiceFee: 0, bookingPayout: 0, trueNet: 0, businessComm: 0, cohostComm: 0, ownerPayout: 0, businessProfit: 0 };
      }
    });
  }, [bookings, expenses, properties]);

  // ── Outstanding issues for the Owner: a "cost" entered by CoHost with no matching "charge" set yet ──
  const outstandingIssues = useMemo(() => {
    if (isCohost) return [];
    const issues = [];
    calc.forEach(b => {
      const spaC = parseFloat(b.spaFeeCost) || 0;
      const spaQ = parseFloat(b.spaFeeCharge) || 0;
      const chC  = parseFloat(b.coHostCalloutCost) || 0;
      const chQ  = parseFloat(b.coHostCalloutCharge) || 0;
      if (spaC > 0 && spaQ === 0) issues.push({ key: `${b.id}-spa`, type: "spa", booking: b, amount: spaC });
      if (chC > 0 && chQ === 0)   issues.push({ key: `${b.id}-callout`, type: "callout", booking: b, amount: chC });
    });
    expenses.forEach(e => {
      if (!e.expenseType) {
        issues.push({ key: `exp-${e.id}`, type: "expense", expense: e });
      }
    });
    return issues;
  }, [calc, expenses, isCohost]);

  // Client sees only their own property's bookings
  const clientCalc = useMemo(() =>
    isClient ? calc.filter(b => b.property === activeProperty) : [],
  [calc, isClient, activeProperty]);

  // CoHost sees only properties assigned to them (from users config)
  const cohostUser = useMemo(() => impersonating
    ? users.find(u => u.role === "cohost" && u.properties.includes(impersonating.cohostProp || ""))
    : null,
  [impersonating, users]);
  const cohostProperties = useMemo(() => {
    if (!isCohost) return PROPERTY_NAMES;
    const u = users.find(u => u.role === "cohost" && (impersonating ? u.properties.some(p => impersonating.cohostProperties?.includes(p)) : true));
    return impersonating?.cohostProperties || PROPERTY_NAMES;
  }, [isCohost, impersonating]);

  const filtered = useMemo(() => {
    let base = isClient ? clientCalc : calc;
    if (isCohost && impersonating?.cohostProperties) {
      base = base.filter(b => impersonating.cohostProperties.includes(b.property));
    }
    return base.filter(b => {
      const propOk   = filterProp === "All" || b.property === filterProp;
      const searchOk = !search || b.guestName.toLowerCase().includes(search.toLowerCase()) || (b.bookingId || "").toLowerCase().includes(search.toLowerCase());
      return propOk && searchOk;
    });
  }, [calc, clientCalc, isClient, isCohost, impersonating, filterProp, search]);

  const totals = useMemo(() => ({
    gross:   sum(filtered, "fullGross"),
    payout:  sum(filtered, "bookingPayout"),
    profit:  sum(filtered, "businessProfit"),
    owner:   sum(filtered, "ownerPayout"),
    trueNet: sum(filtered, "trueNet"),
  }), [filtered]);

  // ── Dashboard filter options & filtered dataset (month/year/property) ──
  const MONTH_NAMES = ["01","02","03","04","05","06","07","08","09","10","11","12"];
  const MONTH_LABELS = { "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec" };
  const dashYears = useMemo(() => {
    const ys = new Set();
    calc.forEach(b => { const parts = (b.startDate||"").split("/"); if (parts[2]) ys.add(parts[2]); });
    return Array.from(ys).sort();
  }, [calc]);

  const dashFiltered = useMemo(() => calc.filter(b => {
    const parts = (b.startDate||"").split("/");
    const month = parts[1], year = parts[2];
    const propOk  = dashProp === "All" || b.property === dashProp;
    const monthOk = dashMonth === "All" || month === dashMonth;
    const yearOk  = dashYear === "All" || year === dashYear;
    return propOk && monthOk && yearOk;
  }), [calc, dashProp, dashMonth, dashYear]);

  // CoHost Callout expenses — standalone expenses categorised as "CoHost Callout"
  // that should appear in the cohost's earnings as additional callout income
  const cohostCalloutExpenses = useMemo(() =>
    expenses.filter(e => e.category === "CoHost Callout" && e.expenseType !== ""),
  [expenses]);

  const dashByProp = useMemo(() => PROPERTY_NAMES.map(p => {
    const rows = dashFiltered.filter(b => b.property === p);
    const expCallouts = cohostCalloutExpenses
      .filter(e => e.property === p)
      .reduce((a, e) => a + (e.amount || 0), 0);
    return { p, count: rows.length, gross: sum(rows, "fullGross"), profit: sum(rows, "businessProfit"), owner: sum(rows, "ownerPayout"), cohostEarnings: sum(rows, "cohostComm"), calloutEarnings: sum(rows, "coHostCalloutCost") + expCallouts };
  }), [dashFiltered, cohostCalloutExpenses]);

  function DashFilterBar() {
    return (
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <select value={dashProp} onChange={e => setDashProp(e.target.value)}
          style={{ padding: "8px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF" }}>
          <option value="All">All Properties</option>
          {PROPERTY_NAMES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={dashMonth} onChange={e => setDashMonth(e.target.value)}
          style={{ padding: "8px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF" }}>
          <option value="All">All Months</option>
          {MONTH_NAMES.map(m => <option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
        </select>
        <select value={dashYear} onChange={e => setDashYear(e.target.value)}
          style={{ padding: "8px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF" }}>
          <option value="All">All Years</option>
          {dashYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {(dashProp !== "All" || dashMonth !== "All" || dashYear !== "All") && (
          <button onClick={() => { setDashProp("All"); setDashMonth("All"); setDashYear("All"); }}
            style={{ padding: "8px 12px", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "#F7F7F7", color: "#666666", cursor: "pointer" }}>
            Clear filters
          </button>
        )}
      </div>
    );
  }

  function openNew()   { setForm(EMPTY); setEditId(null); setShowForm(true); }
  function openEdit(b) { setForm({ ...b }); setEditId(b.id); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditId(null); }

  async function save() {
    if (!form.guestName || !form.fullGross) return;
    if (editId) {
      const { error } = await sb.from("bookings").update(bookingToDb({ ...form, id: editId })).eq("id", editId);
      if (error) { setDbError(error.message); return; }
    } else {
      const newId = nextId(bookings);
      const { error } = await sb.from("bookings").insert(bookingToDb({ ...form, id: newId }));
      if (error) { setDbError(error.message); return; }
    }
    closeForm();
  }

  async function del(id) {
    if (!confirm("Delete this booking?")) return;
    const { error } = await sb.from("bookings").delete().eq("id", id);
    if (error) setDbError(error.message);
  }

  // Find the booking with the latest End Date for a given property
  function lastBookingForProperty(property) {
    const rows = bookings.filter(b => b.property === property);
    if (!rows.length) return null;
    return rows.reduce((latest, b) => parseDMY(b.endDate) >= parseDMY(latest.endDate) ? b : latest, rows[0]);
  }

  async function saveExpense() {
    const amt = parseFloat(expenseForm.amount);
    if (!expenseForm.description || !amt || !expenseForm.category) return;
    let bookingId = null;
    if (expenseForm.bookingLink === "last") {
      const target = lastBookingForProperty(expenseForm.property);
      if (!target) return;
      bookingId = target.id;
    } else if (expenseForm.bookingLink === "specific") {
      if (!expenseForm.bookingId) return;
      bookingId = expenseForm.bookingId;
    }
    const expenseType = isCohost ? "" : expenseForm.expenseType;
    const charge = isCohost ? null : (parseFloat(expenseForm.charge) || null);
    const newExp = {
      id: `EXP${String(expenses.length + 1).padStart(4, "0")}`,
      property: expenseForm.property, description: expenseForm.description,
      amount: amt, charge, category: expenseForm.category,
      date: expenseForm.date || (() => { const d = new Date(); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; })(),
      expenseType, bookingId, resolved: !isCohost,
    };
    const { error } = await sb.from("expenses").insert(expenseToDb(newExp));
    if (error) { setDbError(error.message); return; }
    setShowExpenseModal(false);
    setExpenseForm({ property: "CH", description: "", amount: "", charge: "", expenseType: "business", category: "Maintenance", date: "", bookingLink: "last", bookingId: "" });
  }

  async function deleteExpense(id) {
    const { error } = await sb.from("expenses").delete().eq("id", id);
    if (error) setDbError(error.message);
  }

  function resolveIssue(issue) {
    if (issue.type === "expense") { setResolveExpenseId(issue.expense.id); setResolveChargeInput(""); }
    else { openEdit(issue.booking); }
  }

  async function resolveExpenseType(expenseId, expenseType) {
    const charge = parseFloat(resolveChargeInput);
    const exp = expenses.find(e => e.id === expenseId);
    if (!exp) return;
    const updated = { ...exp, expenseType, charge: isNaN(charge) ? exp.amount : charge, resolved: true };
    const { error } = await sb.from("expenses").update(expenseToDb(updated)).eq("id", expenseId);
    if (error) setDbError(error.message);
    setResolveExpenseId(null); setResolveChargeInput("");
  }

  const btn = (bg, col, disabled) => ({
    background: disabled ? "#E8E8E8" : bg, color: disabled ? "#AAAAAA" : col,
    border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700,
    cursor: disabled ? "default" : "pointer", fontSize: 13, fontFamily: "'Barlow', sans-serif",
    letterSpacing: "0.02em",
  });

  const th = { padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#999999", whiteSpace: "nowrap", borderBottom: "2px solid #F0F0F0", background: "#FAFAFA" };
  const td = { padding: "11px 14px", fontSize: 13, borderBottom: "1px solid #F3F3F3" };


  // Auth gate
  if (authLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0D0D0D", fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🏡</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Loading GuestFavourite…</div>
      </div>
    </div>
  );

  if (!authUser || !profile) return (
    <LoginScreen onLogin={(user, prof) => { setAuthUser(user); setProfile(prof); setTab("bookings"); }} />
  );

  if (dbError) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0D0D0D", fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 400, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Database Error</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>{dbError}</div>
        <button onClick={() => setDbError(null)} style={{ background: "#E61C5D", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
      </div>
    </div>
  );

  const navTabs = ["bookings", "dashboard", "expenses", ...(!isCohost && !isClient ? ["settings"] : [])].filter(t => {
    if (t === "expenses" && isCohost) return false;
    return true;
  });

  return (
    <div style={{ fontFamily: "'Barlow', -apple-system, sans-serif", background: "#FFFFFF", minHeight: "100vh" }}>

      {/* HEADER */}
      <div style={{ background: "#0D0D0D", borderBottom: "2px solid #E61C5D", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>

          {/* Left: wordmark + role */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
              <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 900, fontSize: isMobile ? 17 : 20, color: "#FFFFFF", letterSpacing: "-0.3px" }}>GuestFavour</span>
              <span style={{ position: "relative", fontFamily: "'Barlow', sans-serif", fontWeight: 900, fontSize: isMobile ? 17 : 20, color: "#FFFFFF", letterSpacing: "-0.3px", display: "inline-block" }}>
                ı
                <span style={{ position: "absolute", top: "18%", left: "50%", transform: "translateX(-50%)", width: isMobile ? 4 : 5, height: isMobile ? 4 : 5, borderRadius: "50%", background: "#E61C5D", display: "block" }}/>
              </span>
              <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 900, fontSize: isMobile ? 17 : 20, color: "#FFFFFF", letterSpacing: "-0.3px" }}>te</span>
            </div>
            <span style={{
              background: isCohost ? "rgba(243,198,105,0.15)" : isClient ? "rgba(230,28,93,0.12)" : "rgba(230,28,93,0.12)",
              color:      isCohost ? "#F3C669" : "#E61C5D",
              borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0
            }}>{isClient ? activeProperty : ROLE_LABELS[activeRole]}</span>
          </div>

          {/* Right: desktop nav + actions OR mobile menu button */}
          {isMobile ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {impersonating && (
                <button onClick={() => { setImpersonating(null); setTab("settings"); }}
                  style={{ background: "#f59e0b", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 700, fontSize: 11, color: "#fff" }}>
                  ← Exit
                </button>
              )}
              <button onClick={() => setShowMobileMenu(m => !m)}
                style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "#fff", fontSize: 16 }}>
                {showMobileMenu ? "✕" : "☰"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {navTabs.map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, background: tab === t ? "#E61C5D" : "transparent", color: tab === t ? "#fff" : "#888", textTransform: "capitalize" }}>{t}</button>
              ))}
              {impersonating && (
                <button onClick={() => { setImpersonating(null); setTab("settings"); }}
                  style={{ background: "#f59e0b", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontWeight: 700, fontSize: 11, color: "#fff" }}>
                  ← Exit {impersonating.userName}'s view
                </button>
              )}
              {!impersonating && <button onClick={() => { sb.auth.signOut(); }} style={{ background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontWeight: 600, fontSize: 11, color: "#888" }}>Log out</button>}
            </div>
          )}
        </div>

        {/* Mobile dropdown menu */}
        {isMobile && showMobileMenu && (
          <div style={{ background: "#1A1A1A", borderTop: "1px solid #333", padding: "8px 0" }}>
            {navTabs.map(t => (
              <button key={t} onClick={() => { setTab(t); setShowMobileMenu(false); }}
                style={{ display: "block", width: "100%", padding: "12px 20px", background: tab === t ? "#E61C5D" : "transparent", color: tab === t ? "#fff" : "#aaa", border: "none", textAlign: "left", fontWeight: 700, fontSize: 14, cursor: "pointer", textTransform: "capitalize", fontFamily: "'Barlow', sans-serif" }}>
                {t}
              </button>
            ))}
            <div style={{ borderTop: "1px solid #333", margin: "8px 0" }} />
            {!impersonating && (
              <button onClick={() => { sb.auth.signOut(); setShowMobileMenu(false); }}
                style={{ display: "block", width: "100%", padding: "12px 20px", background: "transparent", color: "#E61C5D", border: "none", textAlign: "left", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Barlow', sans-serif" }}>
                Log out
              </button>
            )}
          </div>
        )}
      </div>

      {/* OUTSTANDING ISSUES BANNER (Owner only) */}
      {!isCohost && !isClient && outstandingIssues.length > 0 && (
        <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a" }}>
          <div onClick={() => setShowIssues(s => !s)} style={{ cursor: "pointer", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: "#92400e", fontSize: 13 }}>
              ⚠️ {outstandingIssues.length} Outstanding Issue{outstandingIssues.length !== 1 ? "s" : ""} — charges needed to record profit
            </span>
            <span style={{ color: "#92400e", fontSize: 12, fontWeight: 600 }}>{showIssues ? "Hide ▲" : "Show ▼"}</span>
          </div>
          {showIssues && (
            <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {outstandingIssues.map(issue => {
                let label, sub;
                if (issue.type === "spa") {
                  label = `Spa fee cost ${fmt(issue.amount)} recorded — ${issue.booking.property} · ${issue.booking.id} (${issue.booking.guestName})`;
                  sub = "No Spa Fee Charge to Owner set yet";
                } else if (issue.type === "callout") {
                  label = `CoHost callout cost ${fmt(issue.amount)} recorded — ${issue.booking.property} · ${issue.booking.id} (${issue.booking.guestName})`;
                  sub = "No CoHost Callout Charge to Owner set yet";
                } else {
                  const b = bookings.find(bk => bk.id === issue.expense.bookingId);
                  const cat = issue.expense.category ? ` · ${issue.expense.category}` : "";
                  label = `Expense "${issue.expense.description}"${cat} (${fmt(issue.expense.amount)}) — ${issue.expense.property}`;
                  sub = b ? `Allocated to ${b.id} (${b.guestName})` : issue.expense.bookingId ? `Booking ${issue.expense.bookingId}` : "Free-standing — no booking link";
                  sub += " · Charge not yet set";
                }
                return (
                  <div key={issue.key} style={{ background: "#FFFFFF", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0D0D0D" }}>{label}</div>
                      <div style={{ fontSize: 11, color: "#999999", marginTop: 2 }}>{sub}</div>
                    </div>
                    <button onClick={() => resolveIssue(issue)} style={btn("#f59e0b", "#fff", false)}>
                      {issue.type === "expense" ? "Set Charge" : "Resolve"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(14px, 4vw, 28px)" }}>

        {/* BOOKINGS */}
        {tab === "bookings" && (
          <>
            {/* Toolbar — mobile: two rows. Desktop: single row */}
            {isMobile ? (
              <div style={{ marginBottom: 16 }}>
                {/* Row 1: search + property filter side by side */}
                {!isClient && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                      style={{ flex: 1, padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF", outline: "none", minWidth: 0 }} />
                    <select value={filterProp} onChange={e => setFilterProp(e.target.value)}
                      style={{ flex: 1, padding: "9px 10px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF", minWidth: 0 }}>
                      <option value="All">All Properties</option>
                      {PROPERTY_NAMES.map(p => <option key={p}>{p}{!PROPERTIES[p].live ? " (not live)" : ""}</option>)}
                    </select>
                  </div>
                )}
                {/* Row 2: count + action buttons */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#666", flex: 1 }}>
                    {filtered.length} bookings
                    {!isCohost && !isClient && <><br/><strong style={{ color: "#16a34a" }}>{fmt(totals.profit)}</strong> profit</>}
                  </span>
                  {!isClient && (
                    <button onClick={() => { setExpenseForm({ property: "CH", description: "", amount: "" }); setShowExpenseModal(true); }}
                      style={{ padding: "9px 12px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      + Expense
                    </button>
                  )}
                  {!isClient && (
                    <button onClick={openNew}
                      style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: "#E61C5D", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      + Booking
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
                {!isClient && <input placeholder="Search guest or booking ID…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ padding: "9px 14px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, width: 240, background: "#FFFFFF", outline: "none" }} />}
                {!isClient && <select value={filterProp} onChange={e => setFilterProp(e.target.value)}
                  style={{ padding: "9px 14px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF" }}>
                  <option value="All">All Properties</option>
                  {PROPERTY_NAMES.map(p => <option key={p}>{p}{!PROPERTIES[p].live ? " (not live)" : ""}</option>)}
                </select>}
                <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#666666" }}>{filtered.length} bookings{!isCohost && !isClient && <> · Profit: <strong style={{ color: "#16a34a" }}>{fmt(totals.profit)}</strong></>}</span>
                  {!isClient && <button onClick={() => { setExpenseForm({ property: "CH", description: "", amount: "" }); setShowExpenseModal(true); }} style={btn("#f97316", "#fff", false)}>+ Add Expense / Callout</button>}
                  {!isClient && <button onClick={openNew} style={btn("#E61C5D", "#fff", false)}>+ New Booking</button>}
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#555555", marginBottom: 8 }}>No bookings yet</div>
                {!isClient && (
                  <>
                    <div style={{ fontSize: 13, marginBottom: 20 }}>Click "+ New Booking" to add your first AirBNB booking</div>
                    <button onClick={openNew} style={btn("#E61C5D", "#fff", false)}>+ New Booking</button>
                  </>
                )}
                {isClient && <div style={{ fontSize: 13, color: "#999" }}>No bookings have been recorded for your property yet.</div>}
              </div>
            ) : isMobile ? (
              /* ── MOBILE: booking cards ── */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filtered.map(b => {
                  const platColor = b.platform === "Booking" ? "#003580" : b.platform === "Website" ? "#16a34a" : b.platform === "VRBO" ? "#0891b2" : "#E61C5D";
                  return (
                    <div key={b.id} style={{ background: "#FFFFFF", borderRadius: 12, border: "1px solid #F0F0F0", boxShadow: "0 2px 6px rgba(0,0,0,0.05)", padding: 16 }}>
                      {/* Card header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 15, color: "#0D0D0D" }}>{b.guestName}</div>
                          <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{b.startDate} → {b.endDate}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          <Tag label={b.platform} color={platColor} />
                          {!isClient && <Tag label={b.property} color={propColor(b.property)} />}
                        </div>
                      </div>
                      {/* Key figures */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                        <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>FULL GROSS</div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(b.fullGross)}</div>
                        </div>
                        <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>CLIENT PAYOUT</div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#059669" }}>{fmt(b.ownerPayout)}</div>
                        </div>
                        {!isCohost && !isClient && (
                          <>
                            <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>TRUE NET</div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#7c3aed" }}>{fmt(b.trueNet)}</div>
                            </div>
                            <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "8px 10px" }}>
                              <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>BIZ PROFIT</div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#16a34a" }}>{fmt(b.businessProfit)}</div>
                            </div>
                          </>
                        )}
                        {isCohost && (
                          <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>MY COMMISSION</div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#db2777" }}>{fmt(b.cohostComm)}</div>
                          </div>
                        )}
                      </div>
                      {/* Actions */}
                      {!isClient && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { setInvoice(b); setEmailTo(""); setEmailSent(false); }} style={{ flex: 1, background: "#eff6ff", color: "#2563eb", border: "none", borderRadius: 8, padding: "8px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Invoice</button>
                          <button onClick={() => openEdit(b)} style={{ flex: 1, background: "#f0fdf4", color: "#16a34a", border: "none", borderRadius: 8, padding: "8px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Edit</button>
                          <button onClick={() => del(b.id)} style={{ flex: 1, background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 8, padding: "8px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Delete</button>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: "#bbb" }}>{b.id}</div>
                        {attachmentCounts[b.id] > 0 && (
                          <div style={{ fontSize: 11, color: "#666" }}>📎 {attachmentCounts[b.id]} file{attachmentCounts[b.id] !== 1 ? "s" : ""}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead style={{ background: "#F9F9F9" }}>
                      <tr>
                        {(isClient
                          ? ["ID","Platform","Guest","Dates","Full Gross","Channel Fee","Service Fee","Cleaning Fee","Laundry","Spa Charge","Callout Charge","Mgmt Fee","Client Payout"]
                          : isCohost
                            ? ["ID","Property","Platform","Guest","Dates","Full Gross","Base","Guest Fee","Host Fee","Booking Payout","CoHost Comm","Client Payout",""]
                            : ["ID","Property","Platform","Guest","Dates","Full Gross","Base","Guest Fee","Host Fee","Booking Payout","True Net","Biz Comm","CoHost Comm","Client Payout","Biz Profit",""]
                        ).map(h => (
                          <th key={h} style={th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(b => (
                        <tr key={b.id} style={{ background: "#FFFFFF" }}>
                          {isClient ? (
                            <>
                              <td style={{ ...td, fontWeight: 700, color: "#999999", fontSize: 11 }}>{b.id}</td>
                              <td style={td}><Tag label={b.platform} color={b.platform === "Booking" ? "#003580" : b.platform === "Website" ? "#16a34a" : b.platform === "VRBO" ? "#0891b2" : "#E61C5D"} /></td>
                              <td style={{ ...td, fontWeight: 600 }}>{b.guestName}</td>
                              <td style={{ ...td, color: "#666666", whiteSpace: "nowrap", fontSize: 12 }}>{b.startDate} → {b.endDate}</td>
                              <td style={{ ...td, fontWeight: 700 }}>{fmt(b.fullGross)}</td>
                              <td style={{ ...td, color: "#64748b" }}>{fmt(b.hostServiceFee)}</td>
                              <td style={{ ...td, color: "#64748b" }}>{fmt(b.guestServiceFee)}</td>
                              <td style={{ ...td, color: "#64748b" }}>{fmt(b.cleaningFee)}</td>
                              <td style={{ ...td, color: "#64748b" }}>{fmt(b.laundryFees)}</td>
                              <td style={{ ...td, color: "#64748b" }}>{(parseFloat(b.spaFeeCharge)||0) > 0 ? fmt(b.spaFeeCharge) : "—"}</td>
                              <td style={{ ...td, color: "#64748b" }}>{(parseFloat(b.coHostCalloutCharge)||0) > 0 ? fmt(b.coHostCalloutCharge) : "—"}</td>
                              <td style={{ ...td, color: "#8b5cf6" }}>{fmt(b.businessComm)}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#059669" }}>{fmt(b.ownerPayout)}</td>
                            </>
                          ) : (
                            <>
                              <td style={{ ...td, fontWeight: 700, color: "#999999", fontSize: 11 }}>{b.id}</td>
                              <td style={td}><Tag label={b.property} color={propColor(b.property)} /></td>
                              <td style={td}><Tag label={b.platform} color={b.platform === "Booking" ? "#003580" : b.platform === "Website" ? "#16a34a" : b.platform === "VRBO" ? "#0891b2" : "#E61C5D"} /></td>
                              <td style={{ ...td, fontWeight: 600 }}>{b.guestName}</td>
                              <td style={{ ...td, color: "#666666", whiteSpace: "nowrap", fontSize: 12 }}>{b.startDate} → {b.endDate}</td>
                              <td style={{ ...td, fontWeight: 700 }}>{fmt(b.fullGross)}</td>
                              <td style={td}>{fmt(b.base)}</td>
                              <td style={{ ...td, color: "#ef4444" }}>{fmt(b.guestServiceFee)}</td>
                              <td style={{ ...td, color: "#f97316" }}>{fmt(b.hostServiceFee)}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#2563eb" }}>{fmt(b.bookingPayout)}</td>
                              {!isCohost && <td style={{ ...td, color: "#7c3aed" }}>{fmt(b.trueNet)}</td>}
                              {!isCohost && <td style={{ ...td, color: "#8b5cf6", fontWeight: 700 }}>{fmt(b.businessComm)}</td>}
                              <td style={{ ...td, color: "#db2777" }}>{fmt(b.cohostComm)}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#059669" }}>{fmt(b.ownerPayout)}</td>
                              {!isCohost && <td style={{ ...td, fontWeight: 700, color: "#16a34a" }}>{fmt(b.businessProfit)}</td>}
                              <td style={{ ...td, whiteSpace: "nowrap" }}>
                                {attachmentCounts[b.id] > 0 && (
                                  <span title={`${attachmentCounts[b.id]} attachment(s)`} style={{ marginRight: 6, fontSize: 11, color: "#666" }}>📎{attachmentCounts[b.id]}</span>
                                )}
                                <button onClick={() => { setInvoice(b); setEmailTo(""); setEmailSent(false); }} style={{ background: "#eff6ff", color: "#2563eb", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontWeight: 700, fontSize: 11, marginRight: 4 }}>Invoice</button>
                                <button onClick={() => openEdit(b)} style={{ background: "#f0fdf4", color: "#16a34a", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontWeight: 700, fontSize: 11, marginRight: 4 }}>Edit</button>
                                <button onClick={() => del(b.id)} style={{ background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Del</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E8E8E8" }}>
                        {isClient ? (
                          <>
                            <td colSpan={4} style={{ ...td, fontWeight: 700 }}>TOTALS ({filtered.length})</td>
                            <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.gross)}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(filtered,"hostServiceFee"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(filtered,"guestServiceFee"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(filtered,"cleaningFee"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(filtered,"laundryFees"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(filtered,"spaFeeCharge"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(filtered,"coHostCalloutCharge"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#8b5cf6" }}>{fmt(sum(filtered,"businessComm"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#059669" }}>{fmt(totals.owner)}</td>
                          </>
                        ) : (
                          <>
                            <td colSpan={5} style={{ ...td, fontWeight: 700 }}>TOTALS ({filtered.length})</td>
                            <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.gross)}</td>
                            <td colSpan={3} />
                            <td style={{ ...td, fontWeight: 700, color: "#2563eb" }}>{fmt(totals.payout)}</td>
                            {!isCohost && <td style={{ ...td, fontWeight: 700, color: "#7c3aed" }}>{fmt(totals.trueNet)}</td>}
                            {!isCohost && <td style={{ ...td, fontWeight: 700, color: "#8b5cf6" }}>{fmt(sum(filtered,"businessComm"))}</td>}
                            <td style={{ ...td, fontWeight: 700, color: "#db2777" }}>{fmt(sum(filtered,"cohostComm"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#059669" }}>{fmt(totals.owner)}</td>
                            {!isCohost && <td style={{ ...td, fontWeight: 700, color: "#16a34a" }}>{fmt(totals.profit)}</td>}
                            <td />
                          </>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {!isClient && expenses.length > 0 && (
              <>
                <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginTop: 28, marginBottom: 14, fontSize: 15 }}>Recorded Expenses</h3>
                <div style={{ fontSize: 12, color: "#999999", marginBottom: 12 }}>
                  Business Expenses come out of the business's profit; Client Expenses come out of that property's client payout.
                </div>
                <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead style={{ background: "#F9F9F9" }}>
                        <tr>
                          {["Property","Description","Amount","Type","Allocated To",""].map(h => <th key={h} style={th}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map(e => {
                          const b = bookings.find(bk => bk.id === e.bookingId);
                          return (
                            <tr key={e.id} style={{ background: "#FFFFFF" }}>
                              <td style={td}><Tag label={e.property} color={propColor(e.property)} /></td>
                              <td style={{ ...td, fontWeight: 600 }}>{e.description}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(e.amount)}</td>
                              <td style={td}>
                                <Tag label={e.type === "owner" ? "Client Expense" : "Business Expense"} color={e.type === "owner" ? "#0891b2" : "#8b5cf6"} />
                              </td>
                              <td style={{ ...td, color: "#666666", fontSize: 12 }}>{b ? `${b.id} (${b.guestName}, ended ${b.endDate})` : e.bookingId}</td>
                              <td style={td}>
                                <button onClick={() => deleteExpense(e.id)} style={{ background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Del</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* CLIENT DASHBOARD */}
        {tab === "dashboard" && isClient && (() => {
          const MONTH_NAMES_C  = ["01","02","03","04","05","06","07","08","09","10","11","12"];
          const MONTH_LABELS_C = { "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec" };
          const [cdProp, cdPropSet]   = [dashProp,  setDashProp];
          const [cdMonth, cdMonthSet] = [dashMonth, setDashMonth];
          const [cdYear,  cdYearSet]  = [dashYear,  setDashYear];
          const cdYears = [...new Set(clientCalc.map(b => (b.startDate||"").split("/")[2]).filter(Boolean))].sort();
          const cdFiltered = clientCalc.filter(b => {
            const parts = (b.startDate||"").split("/");
            return (cdMonth === "All" || parts[1] === cdMonth)
                && (cdYear  === "All" || parts[2] === cdYear);
          });
          const clientExpenses = expenses.filter(e =>
            e.property === clientProperty && e.expenseType === "owner" && e.charge != null
          ).filter(e => {
            const parts = (e.date||"").split("/");
            return (cdMonth === "All" || parts[1] === cdMonth)
                && (cdYear  === "All" || parts[2] === cdYear);
          });
          const selSty = { padding: "8px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF" };
          const hasFilters = cdMonth !== "All" || cdYear !== "All";
          return (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0D0D0D", letterSpacing: "-0.3px", marginBottom: 20 }}>My Earnings — {clientProperty}</h2>

              {/* Filter bar */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
                <select value={cdMonth} onChange={e => cdMonthSet(e.target.value)} style={selSty}>
                  <option value="All">All Months</option>
                  {MONTH_NAMES_C.map(m => <option key={m} value={m}>{MONTH_LABELS_C[m]}</option>)}
                </select>
                <select value={cdYear} onChange={e => cdYearSet(e.target.value)} style={selSty}>
                  <option value="All">All Years</option>
                  {cdYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {hasFilters && (
                  <button onClick={() => { cdMonthSet("All"); cdYearSet("All"); }}
                    style={{ padding: "8px 12px", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "#F7F7F7", color: "#666666", cursor: "pointer" }}>
                    Clear filters
                  </button>
                )}
              </div>

              {clientCalc.length === 0 ? (
                <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#555555" }}>No bookings recorded yet for {clientProperty}</div>
                </div>
              ) : cdFiltered.length === 0 ? (
                <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#555555" }}>No bookings match these filters</div>
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px,1fr))", gap: 14, marginBottom: 24 }}>
                    {[
                      { label: "Bookings",          value: cdFiltered.length,                           icon: "📋", color: "#0D0D0D" },
                      { label: "Total Gross",        value: fmt(sum(cdFiltered,"fullGross")),            icon: "💷", color: "#2563eb" },
                      { label: "Total Fees",      value: fmt(sum(cdFiltered,"fullGross") - sum(cdFiltered,"ownerPayout")), icon: "💳", color: "#f97316" },
                      { label: "Client Payout",      value: fmt(sum(cdFiltered,"ownerPayout")),          icon: "💰", color: "#059669" },
                      { label: "Client Expenses",    value: fmt(sum(clientExpenses,"charge")),           icon: "💸", color: "#f97316" },
                      { label: "Net After Expenses", value: fmt(sum(cdFiltered,"ownerPayout") - sum(clientExpenses,"charge")), icon: "✅", color: "#16a34a" },
                    ].map(k => (
                      <div key={k.label} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0" }}>
                        <div style={{ fontSize: 22, marginBottom: 8 }}>{k.icon}</div>
                        <div style={{ fontSize: 11, color: "#999999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Per-booking breakdown */}
                  <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>Booking Breakdown</h3>
                  <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden", marginBottom: 24 }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ background: "#F9F9F9" }}>
                          <tr>{["ID","Platform","Guest","Dates","Full Gross","Channel Fee","Service Fee","Cleaning","Laundry","Spa Charge","Callout Charge","Mgmt Fee","Client Payout"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {cdFiltered.map(b => {
                            return (
                              <tr key={b.id} style={{ background: "#FFFFFF" }}>
                                <td style={{ ...td, fontWeight: 700, color: "#999999", fontSize: 11 }}>{b.id}</td>
                                <td style={td}><Tag label={b.platform} color={b.platform === "Booking" ? "#003580" : b.platform === "Website" ? "#16a34a" : b.platform === "VRBO" ? "#0891b2" : "#E61C5D"} /></td>
                                <td style={{ ...td, fontWeight: 600 }}>{b.guestName}</td>
                                <td style={{ ...td, color: "#666666", whiteSpace: "nowrap", fontSize: 12 }}>{b.startDate} → {b.endDate}</td>
                                <td style={{ ...td, fontWeight: 700 }}>{fmt(b.fullGross)}</td>
                                <td style={{ ...td, color: "#64748b" }}>{fmt(b.hostServiceFee)}</td>
                                <td style={{ ...td, color: "#64748b" }}>{fmt(b.guestServiceFee)}</td>
                                <td style={{ ...td, color: "#64748b" }}>{fmt(b.cleaningFee)}</td>
                                <td style={{ ...td, color: "#64748b" }}>{fmt(b.laundryFees)}</td>
                                <td style={{ ...td, color: "#64748b" }}>{(parseFloat(b.spaFeeCharge)||0) > 0 ? fmt(b.spaFeeCharge) : "—"}</td>
                                <td style={{ ...td, color: "#64748b" }}>{(parseFloat(b.coHostCalloutCharge)||0) > 0 ? fmt(b.coHostCalloutCharge) : "—"}</td>
                                <td style={{ ...td, color: "#8b5cf6" }}>{fmt(b.businessComm)}</td>
                                <td style={{ ...td, fontWeight: 700, color: "#059669" }}>{fmt(b.ownerPayout)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E8E8E8" }}>
                            <td colSpan={4} style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                            <td style={{ ...td, fontWeight: 700 }}>{fmt(sum(cdFiltered,"fullGross"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(cdFiltered,"hostServiceFee"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(cdFiltered,"guestServiceFee"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(cdFiltered,"cleaningFee"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(cdFiltered,"laundryFees"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(cdFiltered,"spaFeeCharge"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#64748b" }}>{fmt(sum(cdFiltered,"coHostCalloutCharge"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#8b5cf6" }}>{fmt(sum(cdFiltered,"businessComm"))}</td>
                            <td style={{ ...td, fontWeight: 700, color: "#059669" }}>{fmt(sum(cdFiltered,"ownerPayout"))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Client expenses charged to them */}
                  {clientExpenses.length > 0 && (
                    <>
                      <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>Expenses Charged to You</h3>
                      <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden" }}>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead style={{ background: "#F9F9F9" }}>
                              <tr>{["Date","Category","Description","Charge"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {clientExpenses.map(e => (
                                <tr key={e.id} style={{ background: "#FFFFFF" }}>
                                  <td style={{ ...td, color: "#666666", fontSize: 12 }}>{e.date || "—"}</td>
                                  <td style={td}><Tag label={e.category || "—"} color={{ Maintenance:"#f97316",Callout:"#ef4444",Hamper:"#8b5cf6",Replenishables:"#0891b2",Other:"#64748b" }[e.category] || "#64748b"} /></td>
                                  <td style={{ ...td, fontWeight: 600 }}>{e.description}</td>
                                  <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(e.charge)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E8E8E8" }}>
                                <td colSpan={3} style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                                <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(sum(clientExpenses,"charge"))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          );
        })()}

        {/* COHOST DASHBOARD */}
        {tab === "dashboard" && isCohost && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0D0D0D", letterSpacing: "-0.3px", marginBottom: 20 }}>My Earnings</h2>
            {calc.length === 0 ? (
              <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#555555" }}>No data yet — add some bookings first</div>
              </div>
            ) : (
              <>
                <DashFilterBar />
                {dashFiltered.length === 0 ? (
                  <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#555555" }}>No bookings match these filters</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
                      {[
                        { label: "Bookings",            value: dashFiltered.length,                                                          icon: "📋", color: "#0D0D0D" },
                        { label: "Commission Earnings", value: fmt(sum(dashFiltered,"cohostComm")),                                          icon: "📊", color: "#8b5cf6" },
                        { label: "Callout Earnings",    value: fmt(sum(dashFiltered,"coHostCalloutCost") + sum(cohostCalloutExpenses.filter(e => { const parts=(e.date||"").split("/"); return (dashMonth==="All"||parts[1]===dashMonth)&&(dashYear==="All"||parts[2]===dashYear); }),"amount")),  icon: "🔧", color: "#f97316" },
                        { label: "Total Earnings",      value: fmt(sum(dashFiltered,"cohostComm") + sum(dashFiltered,"coHostCalloutCost") + sum(cohostCalloutExpenses.filter(e => { const parts=(e.date||"").split("/"); return (dashMonth==="All"||parts[1]===dashMonth)&&(dashYear==="All"||parts[2]===dashYear); }),"amount")), icon: "💰", color: "#db2777" },
                      ].map(k => (
                        <div key={k.label} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0" }}>
                          <div style={{ fontSize: 22, marginBottom: 8 }}>{k.icon}</div>
                          <div style={{ fontSize: 11, color: "#999999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
                        </div>
                      ))}
                    </div>
                    <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>Earnings by Property</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 14, marginBottom: 24 }}>
                      {dashByProp.filter(p => p.count > 0).map(({ p, count, cohostEarnings, calloutEarnings }) => (
                        <div key={p} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", borderTop: `4px solid ${propColor(p)}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <span style={{ fontWeight: 800, fontSize: 17 }}>{p}</span>
                            <Tag label={`${count} bookings`} color={propColor(p)} />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div><div style={{ fontSize: 10, color: "#999999", marginBottom: 3 }}>COMMISSION</div><div style={{ fontWeight: 700, color: "#8b5cf6" }}>{fmt(cohostEarnings)}</div></div>
                            <div><div style={{ fontSize: 10, color: "#999999", marginBottom: 3 }}>CALLOUTS</div><div style={{ fontWeight: 700, color: "#f97316" }}>{fmt(calloutEarnings)}</div></div>
                            <div style={{ gridColumn: "1/-1", borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
                              <div style={{ fontSize: 10, color: "#999999", marginBottom: 3 }}>EARNINGS</div>
                              <div style={{ fontWeight: 800, fontSize: 18, color: "#db2777" }}>{fmt(cohostEarnings + calloutEarnings)}</div>
                            </div>
                          </div>
                          <div style={{ marginTop: 10, fontSize: 11, color: "#999999" }}>
                            {+(PROPERTIES[p].cohost*100).toFixed(1)}% commission rate
                          </div>
                        </div>
                      ))}
                    </div>
                    <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>Per-Booking Breakdown</h3>
                    <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden" }}>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead style={{ background: "#F9F9F9" }}>
                            <tr>
                              {["ID","Property","Guest","Dates","Total","Commission","Callout","Earnings"].map(h => <th key={h} style={th}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {dashFiltered.map(b => {
                              const cohostRate = PROPERTIES[b.property]?.cohost || 0;
                              const totalBase = cohostRate > 0 ? b.cohostComm / cohostRate : 0;
                              const calloutEarn = b.coHostCalloutCost || 0;
                              return (
                                <tr key={b.id} style={{ background: "#FFFFFF" }}>
                                  <td style={{ ...td, fontWeight: 700, color: "#999999", fontSize: 11 }}>{b.id}</td>
                                  <td style={td}><Tag label={b.property} color={propColor(b.property)} /></td>
                                  <td style={{ ...td, fontWeight: 600 }}>{b.guestName}</td>
                                  <td style={{ ...td, color: "#666666", whiteSpace: "nowrap", fontSize: 12 }}>{b.startDate} → {b.endDate}</td>
                                  <td style={{ ...td, color: "#7c3aed" }}>{cohostRate > 0 ? fmt(totalBase) : "—"}</td>
                                  <td style={{ ...td, fontWeight: 700, color: "#8b5cf6" }}>{fmt(b.cohostComm)}</td>
                                  <td style={{ ...td, color: "#f97316" }}>{calloutEarn > 0 ? fmt(calloutEarn) : "—"}</td>
                                  <td style={{ ...td, fontWeight: 700, color: "#db2777" }}>{fmt(b.cohostComm + calloutEarn)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E8E8E8" }}>
                              <td colSpan={5} style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                              <td style={{ ...td, fontWeight: 700, color: "#8b5cf6" }}>{fmt(sum(dashFiltered,"cohostComm"))}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(sum(dashFiltered,"coHostCalloutCost") + sum(dashByProp,"calloutEarnings") - sum(dashFiltered,"coHostCalloutCost"))}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#db2777" }}>{fmt(sum(dashFiltered,"cohostComm") + sum(dashByProp,"calloutEarnings"))}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                    <div style={{ marginTop: 14, fontSize: 12, color: "#999999" }}>
                      "Total" is the booking amount your commission % is calculated from (Booking Payout for {PROPERTY_NAMES.filter(p=>PROPERTIES[p].model==="split").join("/")}, or the client-side net for {PROPERTY_NAMES.filter(p=>PROPERTIES[p].model==="tiered").join("/")}). "Callout" is what you're paid for any cohost callout on that booking, separate from your commission %. "Earnings" is Commission + Callout combined.
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}


        {/* DASHBOARD */}
        {tab === "dashboard" && !isCohost && !isClient && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0D0D0D", letterSpacing: "-0.3px", marginBottom: 20 }}>Dashboard</h2>
            {calc.length === 0 ? (
              <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#555555" }}>No data yet — add some bookings first</div>
              </div>
            ) : (
              <>
                <DashFilterBar />
                {dashFiltered.length === 0 ? (
                  <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#555555" }}>No bookings match these filters</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
                      {[
                        { label: "Bookings",          value: dashFiltered.length,                     icon: "📋", color: "#0D0D0D" },
                        { label: "Total Gross",        value: fmt(sum(dashFiltered,"fullGross")),      icon: "💷", color: "#0D0D0D" },
                        { label: "Booking Payouts",    value: fmt(sum(dashFiltered,"bookingPayout")),  icon: "🏦", color: "#2563eb" },
                        { label: "Business Profit",    value: fmt(sum(dashFiltered,"businessProfit")), icon: "📈", color: "#16a34a" },
                        { label: "Client Payouts",      value: fmt(sum(dashFiltered,"ownerPayout")),    icon: "🏠", color: "#7c3aed" },
                      ].map(k => (
                        <div key={k.label} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0" }}>
                          <div style={{ fontSize: 22, marginBottom: 8 }}>{k.icon}</div>
                          <div style={{ fontSize: 11, color: "#999999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
                        </div>
                      ))}
                    </div>
                    <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>By Property</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 14 }}>
                      {dashByProp.filter(p => p.count > 0).map(({ p, count, gross, profit, owner }) => (
                        <div key={p} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", borderTop: `4px solid ${propColor(p)}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <span style={{ fontWeight: 800, fontSize: 17 }}>{p}</span>
                            <Tag label={`${count} bookings`} color={propColor(p)} />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div><div style={{ fontSize: 10, color: "#999999", marginBottom: 3 }}>GROSS</div><div style={{ fontWeight: 700 }}>{fmt(gross)}</div></div>
                            <div><div style={{ fontSize: 10, color: "#999999", marginBottom: 3 }}>PROFIT</div><div style={{ fontWeight: 700, color: "#16a34a" }}>{fmt(profit)}</div></div>
                            <div style={{ gridColumn: "1/-1" }}><div style={{ fontSize: 10, color: "#999999", marginBottom: 3 }}>CLIENT PAYOUT</div><div style={{ fontWeight: 700, color: "#7c3aed" }}>{fmt(owner)}</div></div>
                          </div>
                          <div style={{ marginTop: 10, fontSize: 11, color: "#999999" }}>
                            {+(PROPERTIES[p].sholom*100).toFixed(0)}% biz · {+(PROPERTIES[p].cohost*100).toFixed(1)}% cohost · {PROPERTIES[p].cohostName} · {PROPERTIES[p].model}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* EXPENSES TAB (Owner only) */}
        {tab === "expenses" && !isCohost && !isClient && (() => {
          const catColors  = { Maintenance: "#f97316", Callout: "#ef4444", Hamper: "#8b5cf6", Replenishables: "#0891b2", Other: "#64748b" };
          const typeColor  = t => t === "business" ? "#8b5cf6" : t === "owner" ? "#0891b2" : "#f59e0b";
          const expYears   = [...new Set(expenses.map(e => (e.date||"").split("/")[2]).filter(Boolean))].sort();
          const MONTH_NAMES_EXP   = ["01","02","03","04","05","06","07","08","09","10","11","12"];
          const MONTH_LABELS_EXP  = { "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec" };
          const expFiltered = expenses.filter(e => {
            const parts = (e.date||"").split("/");
            return (expFilterProp  === "All" || e.property    === expFilterProp)
                && (expFilterCat   === "All" || e.category    === expFilterCat)
                && (expFilterType  === "All" || (expFilterType === "pending" ? !e.expenseType : e.expenseType === expFilterType))
                && (expFilterMonth === "All" || parts[1] === expFilterMonth)
                && (expFilterYear  === "All" || parts[2] === expFilterYear);
          });
          const hasFilters = expFilterProp !== "All" || expFilterCat !== "All" || expFilterType !== "All" || expFilterMonth !== "All" || expFilterYear !== "All";
          const bizExp  = expFiltered.filter(e => e.expenseType === "business");
          const ownExp  = expFiltered.filter(e => e.expenseType === "owner");
          const pendExp = expFiltered.filter(e => !e.expenseType);
          const selSty  = { padding: "8px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF", cursor: "pointer" };
          return (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0D0D0D", letterSpacing: "-0.3px", marginBottom: 20 }}>Expenses</h2>

              {/* Filter bar */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
                <select value={expFilterProp} onChange={e => setExpFilterProp(e.target.value)} style={selSty}>
                  <option value="All">All Properties</option>
                  {PROPERTY_NAMES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={expFilterCat} onChange={e => setExpFilterCat(e.target.value)} style={selSty}>
                  <option value="All">All Categories</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={expFilterType} onChange={e => setExpFilterType(e.target.value)} style={selSty}>
                  <option value="All">All Types</option>
                  <option value="business">Business</option>
                  <option value="owner">Client</option>
                  <option value="pending">Pending</option>
                </select>
                <select value={expFilterMonth} onChange={e => setExpFilterMonth(e.target.value)} style={selSty}>
                  <option value="All">All Months</option>
                  {MONTH_NAMES_EXP.map(m => <option key={m} value={m}>{MONTH_LABELS_EXP[m]}</option>)}
                </select>
                <select value={expFilterYear} onChange={e => setExpFilterYear(e.target.value)} style={selSty}>
                  <option value="All">All Years</option>
                  {expYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {hasFilters && (
                  <button onClick={() => { setExpFilterProp("All"); setExpFilterCat("All"); setExpFilterType("All"); setExpFilterMonth("All"); setExpFilterYear("All"); }}
                    style={{ padding: "8px 12px", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "#F7F7F7", color: "#666666", cursor: "pointer" }}>
                    Clear filters
                  </button>
                )}
              </div>

              {expenses.length === 0 ? (
                <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>💸</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#555555" }}>No expenses recorded yet</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>Use "+ Add Expense / Callout" on the Bookings page</div>
                </div>
              ) : expFiltered.length === 0 ? (
                <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#555555" }}>No expenses match these filters</div>
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
                    {[
                      { label: "Total Expenses",    value: fmt(sum(expFiltered,"amount")), icon: "💸", color: "#0D0D0D" },
                      { label: "Business Expenses", value: fmt(sum(bizExp,"amount")),      icon: "📊", color: "#8b5cf6" },
                      { label: "Client Expenses",    value: fmt(sum(ownExp,"amount")),      icon: "🏠", color: "#0891b2" },
                      { label: "Pending Review",    value: `${pendExp.length} item${pendExp.length !== 1 ? "s" : ""}`, icon: "⏳", color: "#f59e0b" },
                    ].map(k => (
                      <div key={k.label} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0" }}>
                        <div style={{ fontSize: 22, marginBottom: 8 }}>{k.icon}</div>
                        <div style={{ fontSize: 11, color: "#999999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Category summary cards */}
                  <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>By Category</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, marginBottom: 24 }}>
                    {EXPENSE_CATEGORIES.map(cat => {
                      const catEs = expFiltered.filter(e => e.category === cat);
                      if (!catEs.length) return null;
                      return (
                        <div key={cat} style={{ background: "#FFFFFF", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", borderTop: `3px solid ${catColors[cat] || "#64748b"}` }}>
                          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{cat}</div>
                          <div style={{ fontWeight: 800, fontSize: 18, color: catColors[cat] || "#64748b" }}>{fmt(sum(catEs,"amount"))}</div>
                          <div style={{ fontSize: 11, color: "#999999", marginTop: 4 }}>{catEs.length} item{catEs.length !== 1 ? "s" : ""}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Full expenses table */}
                  <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>All Expenses</h3>
                  <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ background: "#F9F9F9" }}>
                          <tr>{["Date","Property","Category","Description","Cost","Charge","Type","Linked Booking",""].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {[...expFiltered].sort((a,b) => parseDMY(b.date) - parseDMY(a.date) || 0).map(e => {
                            const bk = bookings.find(b => b.id === e.bookingId);
                            return (
                              <tr key={e.id} style={{ background: "#FFFFFF" }}>
                                <td style={{ ...td, color: "#666666", fontSize: 12 }}>{e.date || "—"}</td>
                                <td style={td}><Tag label={e.property} color={propColor(e.property)} /></td>
                                <td style={td}><Tag label={e.category || "—"} color={catColors[e.category] || "#64748b"} /></td>
                                <td style={{ ...td, fontWeight: 600 }}>{e.description}</td>
                                <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(e.amount)}</td>
                                <td style={{ ...td, color: "#16a34a" }}>{e.charge != null ? fmt(e.charge) : "—"}</td>
                                <td style={td}><Tag label={e.expenseType === "business" ? "Business" : e.expenseType === "owner" ? "Owner" : "Pending"} color={typeColor(e.expenseType)} /></td>
                                <td style={{ ...td, color: "#666666", fontSize: 12 }}>{bk ? `${bk.id} (${bk.guestName})` : e.bookingId ? e.bookingId : "Free-standing"}</td>
                                <td style={td}><button onClick={() => deleteExpense(e.id)} style={{ background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Del</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E8E8E8" }}>
                            <td colSpan={4} style={{ ...td, fontWeight: 700 }}>TOTAL ({expFiltered.length})</td>
                            <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(sum(expFiltered,"amount"))}</td>
                            <td colSpan={3} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}
        {/* EXPENSES TAB (Client only) */}
        {tab === "expenses" && isClient && (() => {
          const MONTH_NAMES_CE  = ["01","02","03","04","05","06","07","08","09","10","11","12"];
          const MONTH_LABELS_CE = { "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec" };
          const catColors = { Maintenance:"#f97316", Callout:"#ef4444", Hamper:"#8b5cf6", Replenishables:"#0891b2", Other:"#64748b" };
          // All expenses charged to this client (owner-typed, charge set)
          const allClientExp = expenses.filter(e =>
            e.property === clientProperty && e.expenseType === "owner" && e.charge != null
          );
          const expYearsC = [...new Set(allClientExp.map(e => (e.date||"").split("/")[2]).filter(Boolean))].sort();
          const [ceCat,   setCeCat]   = [expFilterCat,   setExpFilterCat];
          const [ceMonth, setCeMonth] = [expFilterMonth, setExpFilterMonth];
          const [ceYear,  setCeYear]  = [expFilterYear,  setExpFilterYear];
          const ceFiltered = allClientExp.filter(e => {
            const parts = (e.date||"").split("/");
            return (ceCat   === "All" || e.category === ceCat)
                && (ceMonth === "All" || parts[1]    === ceMonth)
                && (ceYear  === "All" || parts[2]    === ceYear);
          });
          const hasFilters = ceCat !== "All" || ceMonth !== "All" || ceYear !== "All";
          const selSty = { padding: "8px 12px", border: "1.5px solid #E8E8E8", borderRadius: 10, fontSize: 13, background: "#FFFFFF" };
          return (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0D0D0D", letterSpacing: "-0.3px", marginBottom: 20 }}>Expenses — {clientProperty}</h2>

              {/* Filter bar */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
                <select value={ceCat} onChange={e => setCeCat(e.target.value)} style={selSty}>
                  <option value="All">All Categories</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={ceMonth} onChange={e => setCeMonth(e.target.value)} style={selSty}>
                  <option value="All">All Months</option>
                  {MONTH_NAMES_CE.map(m => <option key={m} value={m}>{MONTH_LABELS_CE[m]}</option>)}
                </select>
                <select value={ceYear} onChange={e => setCeYear(e.target.value)} style={selSty}>
                  <option value="All">All Years</option>
                  {expYearsC.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {hasFilters && (
                  <button onClick={() => { setCeCat("All"); setCeMonth("All"); setCeYear("All"); }}
                    style={{ padding: "8px 12px", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "#F7F7F7", color: "#666666", cursor: "pointer" }}>
                    Clear filters
                  </button>
                )}
              </div>

              {allClientExp.length === 0 ? (
                <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>💸</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#555555" }}>No expenses charged to {clientProperty} yet</div>
                </div>
              ) : ceFiltered.length === 0 ? (
                <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 60, textAlign: "center", color: "#999999" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#555555" }}>No expenses match these filters</div>
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
                    {[
                      { label: "Total Expenses",  value: fmt(sum(ceFiltered,"charge")), icon: "💸", color: "#f97316" },
                      { label: "No. of Expenses", value: ceFiltered.length,             icon: "📋", color: "#0D0D0D" },
                    ].map(k => (
                      <div key={k.label} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0" }}>
                        <div style={{ fontSize: 22, marginBottom: 8 }}>{k.icon}</div>
                        <div style={{ fontSize: 11, color: "#999999", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{k.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* By Category */}
                  <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>By Category</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, marginBottom: 24 }}>
                    {EXPENSE_CATEGORIES.map(cat => {
                      const catEs = ceFiltered.filter(e => e.category === cat);
                      if (!catEs.length) return null;
                      return (
                        <div key={cat} style={{ background: "#FFFFFF", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", borderTop: `3px solid ${catColors[cat] || "#64748b"}` }}>
                          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{cat}</div>
                          <div style={{ fontWeight: 800, fontSize: 18, color: catColors[cat] || "#64748b" }}>{fmt(sum(catEs,"charge"))}</div>
                          <div style={{ fontSize: 11, color: "#999999", marginTop: 4 }}>{catEs.length} item{catEs.length !== 1 ? "s" : ""}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Full table — charge only, no cost */}
                  <h3 style={{ fontWeight: 700, color: "#1A1A1A", marginBottom: 14, fontSize: 15 }}>All Expenses</h3>
                  <div style={{ background: "#FFFFFF", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1px solid #F0F0F0", overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ background: "#F9F9F9" }}>
                          <tr>{["Date","Category","Description","Charge"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {[...ceFiltered].sort((a,b) => parseDMY(b.date) - parseDMY(a.date)).map(e => (
                            <tr key={e.id} style={{ background: "#FFFFFF" }}>
                              <td style={{ ...td, color: "#666666", fontSize: 12 }}>{e.date || "—"}</td>
                              <td style={td}><Tag label={e.category || "—"} color={catColors[e.category] || "#64748b"} /></td>
                              <td style={{ ...td, fontWeight: 600 }}>{e.description}</td>
                              <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(e.charge)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E8E8E8" }}>
                            <td colSpan={3} style={{ ...td, fontWeight: 700 }}>TOTAL ({ceFiltered.length})</td>
                            <td style={{ ...td, fontWeight: 700, color: "#f97316" }}>{fmt(sum(ceFiltered,"charge"))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}

        {/* SETTINGS TAB (Owner only) */}
        {tab === "settings" && !isCohost && !isClient && (() => {
          const roleColor = { owner: "#E61C5D", cohost: "#0D0D0D", client: "#0891b2" };
          const roleLabel = { owner: "Owner", cohost: "CoHost", client: "Client" };
          const settingsTabs = ["users", "properties", "platforms"];
          const lbl = { fontSize: 10, fontWeight: 800, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 };
          const inp = { width: "100%", padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'Barlow', sans-serif" };

          async function saveUser() {
            if (!userForm.name || !userForm.role || !userForm.properties.length) return;
            if (editUserId) {
              // Update profile row directly
              await sb.from("profiles").update({
                name: userForm.name, role: userForm.role,
                properties: userForm.properties, active: true,
              }).eq("id", editUserId);
              setEditUserId(null);
            } else {
              // Invite new user by email — Supabase sends them a set-password link
              const { error } = await sb.auth.admin ? 
                // If admin API available use it; otherwise use signUp which sends confirmation
                sb.auth.signUp({
                  email: userForm.email, password: crypto.randomUUID(),
                  options: { data: { name: userForm.name, role: userForm.role, properties: userForm.properties } }
                }) : { error: { message: "Use Supabase dashboard to invite users" } };
              if (error) { alert("Could not create user: " + error.message + "\n\nTo add users, go to your Supabase dashboard → Authentication → Users → Invite user, then update their profile in the Profiles table."); }
            }
            await loadUsers();
            setUserForm({ name: "", email: "", role: "client", properties: [] });
            setShowUserModal(false);
          }

          function startImpersonate(u) {
            if (u.role === "client") {
              setImpersonating({ role: "client", clientProperty: u.properties[0], userName: u.name });
            } else if (u.role === "cohost") {
              setImpersonating({ role: "cohost", clientProperty: null, cohostProperties: u.properties, userName: u.name });
            }
            setTab("bookings");
          }

          return (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0D0D0D", letterSpacing: "-0.3px", marginBottom: 20 }}>Settings</h2>

              {/* Settings sub-tabs */}
              <div style={{ display: "flex", gap: 6, marginBottom: 24, borderBottom: "2px solid #F0F0F0", paddingBottom: 0 }}>
                {settingsTabs.map(t => (
                  <button key={t} onClick={() => setSettingsTab(t)}
                    style={{ padding: "8px 18px", border: "none", borderBottom: settingsTab === t ? "2px solid #E61C5D" : "2px solid transparent", background: "transparent", fontWeight: 700, fontSize: 13, cursor: "pointer", color: settingsTab === t ? "#E61C5D" : "#888", textTransform: "capitalize", marginBottom: -2 }}>
                    {t}
                  </button>
                ))}
              </div>

              {/* ── USERS ── */}
              {settingsTab === "users" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: "#666" }}>{users.length} users · <span style={{ color: "#E61C5D" }}>Click "View As" to see the app through their eyes</span></div>
                    <button onClick={() => { setUserForm({ name: "", email: "", role: "client", properties: [] }); setEditUserId(null); setShowUserModal(true); }} style={btn("#E61C5D", "#fff", false)}>+ Add User</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {users.map(u => (
                      <div key={u.id} style={{ background: "#FFFFFF", borderRadius: 12, border: "1px solid #F0F0F0", padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        {/* Avatar */}
                        <div style={{ width: 40, height: 40, borderRadius: "50%", background: roleColor[u.role] + "18", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, color: roleColor[u.role], flexShrink: 0 }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 14, color: "#0D0D0D" }}>{u.name}</div>
                          <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
                            {u.email || "No email set"} · {u.properties.length ? u.properties.join(", ") : "All properties"}
                          </div>
                        </div>
                        <Tag label={roleLabel[u.role]} color={roleColor[u.role]} />
                        {!u.active && <Tag label="Inactive" color="#999" />}
                        <div style={{ display: "flex", gap: 6 }}>
                          {u.role !== "owner" && (
                            <button onClick={() => startImpersonate(u)}
                              style={{ background: "#0D0D0D", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                              View As
                            </button>
                          )}
                          <button onClick={() => { setUserForm({ name: u.name, email: u.email, role: u.role, properties: [...u.properties] }); setEditUserId(u.id); setShowUserModal(true); }}
                            style={{ background: "#F0F0F0", color: "#1A1A1A", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                            Edit
                          </button>
                          {u.role !== "owner" && (
                            <button onClick={async () => {
                                await sb.from("profiles").update({ active: !u.active }).eq("id", u.id);
                                await loadUsers();
                              }}
                              style={{ background: u.active ? "#fef2f2" : "#f0fdf4", color: u.active ? "#dc2626" : "#16a34a", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                              {u.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── PROPERTIES ── */}
              {settingsTab === "properties" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: "#666" }}>{PROPERTY_NAMES.length} properties</div>
                    <button onClick={() => {
                      setPropertyForm({ name: "", sholom: "", cohost: "", cohostName: "", model: "tiered", live: false });
                      setEditPropertyName(null);
                      setShowPropertyModal(true);
                    }} style={btn("#E61C5D", "#fff", false)}>+ Add Property</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {PROPERTY_NAMES.map(p => {
                      const prop = PROPERTIES[p];
                      return (
                        <div key={p} style={{ background: "#FFFFFF", borderRadius: 12, border: "1px solid #F0F0F0", padding: "18px 20px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Tag label={p} color={propColor(p)} />
                              <span style={{ fontSize: 12, color: "#999" }}>{prop.model} model · {prop.cohostName}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <Tag label={prop.live ? "Live" : "Not live"} color={prop.live ? "#16a34a" : "#999"} />
                              <button onClick={async () => {
                                await sb.from("properties").update({ live: !prop.live }).eq("code", p);
                              }}
                                style={{ background: prop.live ? "#fef2f2" : "#f0fdf4", color: prop.live ? "#dc2626" : "#16a34a", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                                {prop.live ? "Set offline" : "Go live"}
                              </button>
                              <button onClick={() => {
                                setPropertyForm({ name: p, sholom: (+(prop.sholom*100).toFixed(2)).toString(), cohost: (+(prop.cohost*100).toFixed(2)).toString(), cohostName: prop.cohostName, model: prop.model, live: prop.live });
                                setEditPropertyName(p);
                                setShowPropertyModal(true);
                              }} style={{ background: "#F0F0F0", color: "#1A1A1A", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                                Edit
                              </button>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
                            <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "10px 12px" }}>
                              <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>BIZ COMMISSION</div>
                              <div style={{ fontWeight: 800, fontSize: 18, color: "#E61C5D" }}>{+(prop.sholom*100).toFixed(0)}%</div>
                              <div style={{ fontSize: 11, color: "#bbb" }}>of True Net</div>
                            </div>
                            <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "10px 12px" }}>
                              <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>COHOST COMMISSION</div>
                              <div style={{ fontWeight: 800, fontSize: 18, color: "#0D0D0D" }}>{+(prop.cohost*100).toFixed(1)}%</div>
                              <div style={{ fontSize: 11, color: "#bbb" }}>{prop.model === "split" ? "of Booking Payout" : "of (True Net − Biz)"}</div>
                            </div>
                            <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "10px 12px" }}>
                              <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>COHOST</div>
                              <div style={{ fontWeight: 800, fontSize: 14, color: "#0D0D0D" }}>{prop.cohostName || "—"}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add / Edit Property Modal */}
                  {showPropertyModal && (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(13,13,13,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}>
                      <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 32, width: "100%", maxWidth: 480 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                          <div style={{ fontWeight: 800, fontSize: 17 }}>{editPropertyName ? `Edit — ${editPropertyName}` : "Add New Property"}</div>
                          <button onClick={() => setShowPropertyModal(false)} style={{ background: "#F0F0F0", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>✕</button>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                          {/* Property name — only editable for new */}
                          <div>
                            <label style={lbl}>Property Name / Code</label>
                            <input value={propertyForm.name}
                              onChange={e => setPropertyForm(f => ({ ...f, name: e.target.value }))}
                              disabled={!!editPropertyName}
                              placeholder="e.g. MK1, LDN or a short code"
                              style={{ ...inp, background: editPropertyName ? "#F9F9F9" : "#fff", color: editPropertyName ? "#999" : "#0D0D0D" }} />
                            {!editPropertyName && <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Short code used throughout the app — can't be changed later.</div>}
                          </div>

                          {/* Commission rates */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                              <label style={lbl}>Biz Commission (%)</label>
                              <input type="number" step="0.1" value={propertyForm.sholom}
                                onChange={e => setPropertyForm(f => ({ ...f, sholom: e.target.value }))}
                                placeholder="e.g. 16" style={inp} />
                              <div style={{ fontSize: 11, color: "#999", marginTop: 3 }}>% of True Net</div>
                            </div>
                            <div>
                              <label style={lbl}>CoHost Commission (%)</label>
                              <input type="number" step="0.1" value={propertyForm.cohost}
                                onChange={e => setPropertyForm(f => ({ ...f, cohost: e.target.value }))}
                                placeholder="e.g. 3.5" style={inp} />
                            </div>
                          </div>

                          {/* CoHost name */}
                          <div>
                            <label style={lbl}>CoHost Name</label>
                            <input value={propertyForm.cohostName}
                              onChange={e => setPropertyForm(f => ({ ...f, cohostName: e.target.value }))}
                              placeholder="e.g. Hayley" style={inp} />
                          </div>

                          {/* Commission model */}
                          <div>
                            <label style={lbl}>Commission Model</label>
                            <div style={{ display: "flex", gap: 8 }}>
                              {[{ key: "split", desc: "CoHost % of Booking Payout" }, { key: "tiered", desc: "CoHost % of (True Net − Biz)" }].map(m => (
                                <button key={m.key} onClick={() => setPropertyForm(f => ({ ...f, model: m.key }))}
                                  style={{ flex: 1, padding: "10px", borderRadius: 8, border: propertyForm.model === m.key ? "2px solid #0D0D0D" : "1.5px solid #E8E8E8", background: propertyForm.model === m.key ? "#F0F0F0" : "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", color: "#0D0D0D" }}>
                                  {m.key.charAt(0).toUpperCase() + m.key.slice(1)}<br/>
                                  <span style={{ fontWeight: 400, fontSize: 10, color: "#999" }}>{m.desc}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Live toggle */}
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <button onClick={() => setPropertyForm(f => ({ ...f, live: !f.live }))}
                              style={{ width: 44, height: 24, borderRadius: 12, border: "none", background: propertyForm.live ? "#16a34a" : "#E8E8E8", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
                              <span style={{ position: "absolute", top: 2, left: propertyForm.live ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.2s", display: "block" }}/>
                            </button>
                            <span style={{ fontSize: 13, fontWeight: 600, color: propertyForm.live ? "#16a34a" : "#999" }}>{propertyForm.live ? "Live" : "Not live yet"}</span>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
                          <button onClick={() => setShowPropertyModal(false)} style={btn("#F0F0F0", "#1A1A1A", false)}>Cancel</button>
                          <button
                            disabled={!propertyForm.name || !propertyForm.sholom}
                            onClick={async () => {
                              const key = editPropertyName || propertyForm.name.trim();
                              const row = { code: key, sholom: parseFloat(propertyForm.sholom)/100, cohost: parseFloat(propertyForm.cohost||0)/100, cohost_name: propertyForm.cohostName, model: propertyForm.model, live: propertyForm.live };
                              const { error } = editPropertyName
                                ? await sb.from("properties").update(row).eq("code", key)
                                : await sb.from("properties").insert(row);
                              if (error) setDbError(error.message);
                              setShowPropertyModal(false);
                            }}
                            style={btn("#E61C5D", "#fff", !propertyForm.name || !propertyForm.sholom)}>
                            {editPropertyName ? "Save Changes" : "Add Property"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── PLATFORMS ── */}
              {settingsTab === "platforms" && (
                <>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Current platform fee rates. These flow into every booking calculation.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(PLATFORMS).map(([name, p]) => (
                      <div key={name} style={{ background: "#FFFFFF", borderRadius: 12, border: "1px solid #F0F0F0", padding: "18px 20px" }}>
                        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
                          <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>GUEST FEE</div>
                            <div style={{ fontWeight: 800, fontSize: 16 }}>{(p.guestFee*100).toFixed(2)}%</div>
                          </div>
                          <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>{p.hostFeeLabel?.toUpperCase() || "HOST FEE"}</div>
                            <div style={{ fontWeight: 800, fontSize: 16 }}>{(p.hostFee*100).toFixed(2)}%</div>
                          </div>
                          <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>CALCULATION</div>
                            <div style={{ fontWeight: 700, fontSize: 12, color: "#666" }}>{p.type}</div>
                          </div>
                        </div>
                        <div style={{ marginTop: 10, fontSize: 11, color: "#bbb" }}>To change rates, update the PLATFORMS config in the code and redeploy.</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Add/Edit User Modal */}
              {showUserModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(13,13,13,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}>
                  <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 32, width: "100%", maxWidth: 460 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                      <div style={{ fontWeight: 800, fontSize: 17 }}>{editUserId ? "Edit User" : "Add New User"}</div>
                      <button onClick={() => { setShowUserModal(false); setEditUserId(null); }} style={{ background: "#F0F0F0", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>✕</button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div><label style={lbl}>Full Name</label>
                        <input value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Hayley Smith" style={inp} />
                      </div>
                      <div><label style={lbl}>Email Address</label>
                        <input type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} placeholder="hayley@email.com" style={inp} />
                      </div>
                      <div><label style={lbl}>Role</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {["cohost","client"].map(r => (
                            <button key={r} onClick={() => setUserForm(f => ({ ...f, role: r, properties: [] }))}
                              style={{ flex: 1, padding: "10px", borderRadius: 8, border: userForm.role === r ? `2px solid ${roleColor[r]}` : "1.5px solid #E8E8E8", background: userForm.role === r ? roleColor[r]+"18" : "#fff", color: userForm.role === r ? roleColor[r] : "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                              {roleLabel[r]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div><label style={lbl}>Properties</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {PROPERTY_NAMES.map(p => {
                            const sel = userForm.properties.includes(p);
                            return (
                              <button key={p} onClick={() => setUserForm(f => ({ ...f, properties: sel ? f.properties.filter(x => x !== p) : [...f.properties, p] }))}
                                style={{ padding: "7px 14px", borderRadius: 8, border: sel ? `2px solid ${propColor(p)}` : "1.5px solid #E8E8E8", background: sel ? propColor(p)+"18" : "#fff", color: sel ? propColor(p) : "#374151", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                                {p}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
                          {userForm.role === "client" ? "Select the one property this client owns." : "Select all properties this cohost manages."}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                      <button onClick={() => { setShowUserModal(false); setEditUserId(null); }} style={btn("#F0F0F0", "#1A1A1A", false)}>Cancel</button>
                      <button onClick={saveUser} disabled={!userForm.name || !userForm.properties.length} style={btn("#E61C5D", "#fff", !userForm.name || !userForm.properties.length)}>
                        {editUserId ? "Save Changes" : "Add User"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,13,13,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 32, width: "100%", maxWidth: 720, maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, color: "#0D0D0D" }}>{editId ? "Edit Booking" : "New Booking"}</div>
                <div style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>
                  Platform: {form.platform} · {feeBasisLabels(PLATFORMS[form.platform] || PLATFORMS["AirBNB"]).guest}
                  {" · "}{feeBasisLabels(PLATFORMS[form.platform] || PLATFORMS["AirBNB"]).host}
                </div>
              </div>
              <button onClick={closeForm} style={{ background: "#F7F7F7", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700, color: "#666666" }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#999999", textTransform: "uppercase", letterSpacing: "0.06em" }}>Property</label>
                <select value={form.property} onChange={e => setForm(f => ({ ...f, property: e.target.value }))}
                  style={{ padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, background: "#FFFFFF" }}>
                  {PROPERTY_NAMES.map(p => <option key={p} value={p}>{p}{!PROPERTIES[p].live ? " (not live)" : ""}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#999999", textTransform: "uppercase", letterSpacing: "0.06em" }}>Platform</label>
                <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
                  style={{ padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, background: "#FFFFFF" }}>
                  {PLATFORM_NAMES.map(pl => <option key={pl} value={pl}>{pl}</option>)}
                </select>
              </div>
              <Field label="Guest Name" field="guestName" form={form} setForm={setForm} />
              <Field label="Booking ID" form={form} setForm={setForm} field="bookingId" />
              <Field label="Start Date (DD/MM/YYYY)" field="startDate" form={form} setForm={setForm} />
              <Field label="End Date (DD/MM/YYYY)" field="endDate" form={form} setForm={setForm} />
              <Field label="Full Gross — Total guest paid (£)" field="fullGross" form={form} setForm={setForm} type="number" step="0.01" />
              <Field label="Cleaning Fee (£)" field="cleaningFee" form={form} setForm={setForm} type="number" step="0.01" />
              <Field label="Laundry Fees (£)" field="laundryFees" form={form} setForm={setForm} type="number" step="0.01" />
              <Field label="Mistakes (£)" field="mistakes" form={form} setForm={setForm} type="number" step="0.01" />
              {isCohost ? (
                <>
                  <Field label="Spa Fee (£)" field="spaFeeCost" form={form} setForm={setForm} type="number" step="0.01" />
                  <Field label="CoHost Callout (£)" field="coHostCalloutCost" form={form} setForm={setForm} type="number" step="0.01" />
                </>
              ) : (
                <>
                  <Field label="Spa Fee Cost (£)" field="spaFeeCost" form={form} setForm={setForm} type="number" step="0.01" />
                  <Field label="Spa Fee Charge to Owner (£)" field="spaFeeCharge" form={form} setForm={setForm} type="number" step="0.01" />
                  <Field label="CoHost Callout Cost (£)" field="coHostCalloutCost" form={form} setForm={setForm} type="number" step="0.01" />
                  <Field label="CoHost Callout Charge to Owner (£)" field="coHostCalloutCharge" form={form} setForm={setForm} type="number" step="0.01" />
                </>
              )}
            </div>

            <div style={{ marginTop: 14, background: "#F9F9F9", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#555555" }}>
              {isCohost ? (
                <><strong>{form.property}{!PROPERTIES[form.property]?.live ? " — not live yet" : ""}</strong> · CoHost: {PROPERTIES[form.property]?.cohostName}</>
              ) : (
                <>
                  <strong>{form.property}{!PROPERTIES[form.property]?.live ? " — not live yet" : ""}:</strong>{" "}
                  {(PROPERTIES[form.property]?.sholom*100).toFixed(0)}% business (on True Net) ·{" "}
                  {PROPERTIES[form.property]?.model === "tiered"
                    ? `${(PROPERTIES[form.property]?.cohost*100).toFixed(1)}% cohost (on True Net − Biz Comm)`
                    : `${(PROPERTIES[form.property]?.cohost*100).toFixed(1)}% cohost (on Booking Payout)`}{" "}
                  · {PROPERTIES[form.property]?.cohostName}
                </>
              )}
            </div>

            {editId && (
              <Attachments recordType="booking" recordId={editId} authUserId={authUser?.id} readOnly={false} />
            )}
            {!editId && (
              <div style={{ marginTop: 14, fontSize: 12, color: "#999", fontStyle: "italic" }}>Save the booking first to add attachments.</div>
            )}
            <CalcPreview form={form} isCohost={isCohost} />

            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button onClick={closeForm} style={btn("#F0F0F0", "#1A1A1A", false)}>Cancel</button>
              <button onClick={save} disabled={!form.guestName || !form.fullGross} style={btn("#E61C5D", "#fff", !form.guestName || !form.fullGross)}>
                {editId ? "Save Changes" : "Add Booking"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INVOICE MODAL */}
      {invoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,13,13,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 32, width: "100%", maxWidth: 500 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>Invoice — {invoice.id}</div>
              <button onClick={() => setInvoice(null)} style={{ background: "#F7F7F7", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>✕</button>
            </div>
            <div style={{ border: "1.5px solid #E8E8E8", borderRadius: 12, padding: 20, marginBottom: 20, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#E61C5D" }}>GuestFave</div>
                  <div style={{ color: "#999999", fontSize: 11 }}>Invoice {invoice.id} · {invoice.platform}</div>
                </div>
                <div style={{ textAlign: "right", color: "#666666", fontSize: 12 }}>
                  <div>{invoice.startDate} – {invoice.endDate}</div>
                  <div style={{ fontWeight: 700 }}>{invoice.property}</div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["Guest",                          invoice.guestName,               false, null],
                  ["Full Gross (total guest paid)",   fmt(invoice.fullGross),          false, null],
                  ["Base (nightly + cleaning)",       fmt(invoice.base),               false, null],
                  [(() => feeBasisLabels(PLATFORMS[invoice.platform] || PLATFORMS["AirBNB"]).guest)(), fmt(invoice.guestServiceFee), false, null],
                  [(() => feeBasisLabels(PLATFORMS[invoice.platform] || PLATFORMS["AirBNB"]).host)(), fmt(invoice.hostServiceFee), false, null],
                  ["Booking Payout",                  fmt(invoice.bookingPayout),      true,  null],
                  ["True Net",                        fmt(invoice.trueNet),            false, "trueNet"],
                  [`Business Comm (${(PROPERTIES[invoice.property]?.sholom*100).toFixed(0)}%)`, fmt(invoice.businessComm), false, "businessComm"],
                  [`CoHost Comm (${(PROPERTIES[invoice.property]?.cohost*100).toFixed(1)}%)`,   fmt(invoice.cohostComm),   false, null],
                  ["Client Payout",                    fmt(invoice.ownerPayout),        true,  null],
                  ["Business Profit",                 fmt(invoice.businessProfit),     true,  "businessProfit"],
                ].filter(r => !(isCohost && COHOST_HIDDEN_FIELDS.includes(r[3]))).map(([k, v, bold]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#666666" }}>{k}</span>
                    <span style={{ fontWeight: bold ? 700 : 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#999999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Send To</label>
              <input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="owner@email.com"
                style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, boxSizing: "border-box", outline: "none" }} />
            </div>
            {emailSent ? (
              <div style={{ background: "#f0fdf4", color: "#16a34a", borderRadius: 10, padding: "12px 16px", fontWeight: 700, textAlign: "center" }}>✅ Invoice sent to {emailTo}</div>
            ) : (
              <button onClick={() => setEmailSent(true)} disabled={!emailTo} style={btn("#E61C5D", "#fff", !emailTo)}>Send Invoice</button>
            )}
          </div>
        </div>
      )}

      {/* ADD EXPENSE / CALLOUT MODAL */}
      {showExpenseModal && (() => {
        const lastB  = lastBookingForProperty(expenseForm.property);
        const amt    = parseFloat(expenseForm.amount);
        const propBookings = bookings.filter(b => b.property === expenseForm.property);
        // Validation: need description, amount, and booking link if required
        const linkOk = expenseForm.bookingLink === "none"
          || (expenseForm.bookingLink === "last" && !!lastB)
          || (expenseForm.bookingLink === "specific" && !!expenseForm.bookingId);
        const canSave = !!expenseForm.description && !!amt && !!expenseForm.category && linkOk;
        const lbl = { fontSize: 10, fontWeight: 700, color: "#999999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 };
        const inp = { padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", background: "#FFFFFF" };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(13,13,13,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
            <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 32, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Add Expense / Callout</div>
                <button onClick={() => setShowExpenseModal(false)} style={{ background: "#F7F7F7", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>✕</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Property + Date row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div><label style={lbl}>Property</label>
                    <select value={expenseForm.property} onChange={e => setExpenseForm(f => ({ ...f, property: e.target.value }))} style={inp}>
                      {PROPERTY_NAMES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div><label style={lbl}>Date <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— defaults to today if left blank</span></label>
                    <input type="text" placeholder="DD/MM/YYYY" value={expenseForm.date} onChange={e => setExpenseForm(f => ({ ...f, date: e.target.value }))} style={inp} />
                  </div>
                </div>

                {/* Category */}
                <div><label style={lbl}>Category</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {EXPENSE_CATEGORIES.map(c => (
                      <button key={c} onClick={() => setExpenseForm(f => ({ ...f, category: c }))}
                        style={{ padding: "7px 14px", borderRadius: 8, border: expenseForm.category === c ? "2px solid #f97316" : "1.5px solid #E8E8E8", background: expenseForm.category === c ? "#fff7ed" : "#fff", color: expenseForm.category === c ? "#f97316" : "#1A1A1A", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        {c}
                      </button>
                    ))}
                  </div>
                  {expenseForm.category === "CoHost Callout" && (
                    <div style={{ fontSize: 11, color: "#f97316", marginTop: 6, padding: "6px 10px", background: "#fff7ed", borderRadius: 6 }}>
                      This will appear as a callout in the CoHost's earnings dashboard.
                    </div>
                  )}
                </div>

                {/* Description */}
                <div><label style={lbl}>Description</label>
                  <input value={expenseForm.description} onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Replaced broken lamp, emergency lockout fix…" style={inp} />
                </div>

                {/* Amount */}
                <div><label style={lbl}>Amount (£)</label>
                  <input type="number" step="0.01" value={expenseForm.amount} onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))} style={inp} />
                </div>

                {/* Business / Owner type — Owner only */}
                {!isCohost && (
                  <div>
                    <label style={lbl}>Expense Type</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[{ key: "business", label: "Business Expense", color: "#8b5cf6" }, { key: "owner", label: "Client Expense", color: "#0891b2" }].map(t => (
                        <button key={t.key} onClick={() => setExpenseForm(f => ({ ...f, expenseType: t.key }))}
                          style={{ flex: 1, padding: "10px", borderRadius: 8, border: expenseForm.expenseType === t.key ? `2px solid ${t.color}` : "1.5px solid #E8E8E8", background: expenseForm.expenseType === t.key ? `${t.color}18` : "#fff", color: expenseForm.expenseType === t.key ? t.color : "#1A1A1A", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: "#999999", marginTop: 4 }}>
                      {expenseForm.expenseType === "business" ? "Reduces Business Profit." : `Reduces ${expenseForm.property} Client Payout.`}
                    </div>
                  </div>
                )}
                {!isCohost && (
                  <div>
                    <label style={lbl}>Charge (£) <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— optional, what's being charged/reimbursed</span></label>
                    <input type="number" step="0.01" value={expenseForm.charge} onChange={e => setExpenseForm(f => ({ ...f, charge: e.target.value }))} placeholder="0.00 — leave blank if same as cost"
                      style={inp} />
                    {expenseForm.charge && parseFloat(expenseForm.charge) !== parseFloat(expenseForm.amount) && (
                      <div style={{ fontSize: 11, color: "#8b5cf6", marginTop: 4 }}>
                        Difference: {fmt(Math.abs(parseFloat(expenseForm.charge) - parseFloat(expenseForm.amount)))} {parseFloat(expenseForm.charge) > parseFloat(expenseForm.amount) ? "markup" : "absorbed by business"}
                      </div>
                    )}
                  </div>
                )}
                {isCohost && (
                  <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#666666" }}>
                    The owner will classify this as a Business or Owner expense once reviewed.
                  </div>
                )}

                {/* Booking link */}
                <div>
                  <label style={lbl}>Link to Booking</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {[{ key: "last", label: "Most recent" }, { key: "specific", label: "Specific booking" }, { key: "none", label: "Free-standing" }].map(o => (
                      <button key={o.key} onClick={() => setExpenseForm(f => ({ ...f, bookingLink: o.key, bookingId: "" }))}
                        style={{ flex: 1, padding: "8px", borderRadius: 8, border: expenseForm.bookingLink === o.key ? "2px solid #0D0D0D" : "1.5px solid #E8E8E8", background: expenseForm.bookingLink === o.key ? "#f8fafc" : "#fff", color: "#1A1A1A", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {expenseForm.bookingLink === "last" && (
                    lastB
                      ? <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#555555" }}>Linked to <strong>{lastB.id}</strong> — {lastB.guestName} (ended {lastB.endDate})</div>
                      : <div style={{ background: "#fef2f2", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#dc2626" }}>No bookings yet for {expenseForm.property}</div>
                  )}
                  {expenseForm.bookingLink === "specific" && (
                    <select value={expenseForm.bookingId} onChange={e => setExpenseForm(f => ({ ...f, bookingId: e.target.value }))} style={inp}>
                      <option value="">Select a booking…</option>
                      {propBookings.map(b => <option key={b.id} value={b.id}>{b.id} — {b.guestName} ({b.startDate} → {b.endDate})</option>)}
                    </select>
                  )}
                  {expenseForm.bookingLink === "none" && (
                    <div style={{ background: "#F9F9F9", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#666666" }}>This expense won't be tied to any specific booking.</div>
                  )}
                </div>

              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "#999", fontStyle: "italic" }}>
                📎 You can attach receipts or photos after saving the expense.
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
                <button onClick={() => setShowExpenseModal(false)} style={btn("#F0F0F0", "#1A1A1A", false)}>Cancel</button>
                <button onClick={saveExpense} disabled={!canSave} style={btn("#f97316", "#fff", !canSave)}>Save Expense</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* CLASSIFY EXPENSE (resolve outstanding issue) MODAL */}
      {resolveExpenseId && (() => {
        const exp = expenses.find(e => e.id === resolveExpenseId);
        if (!exp) return null;
        const allocated = bookings.find(bk => bk.id === exp.bookingId);
        const chargeVal = parseFloat(resolveChargeInput);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(13,13,13,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
            <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 32, width: "100%", maxWidth: 440 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Review Expense</div>
                <button onClick={() => { setResolveExpenseId(null); setResolveChargeInput(""); }} style={{ background: "#F7F7F7", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700 }}>✕</button>
              </div>

              {/* Expense summary */}
              <div style={{ background: "#F9F9F9", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#555555", marginBottom: 18 }}>
                <strong>{exp.description}</strong>{exp.category ? ` · ${exp.category}` : ""}<br />
                {exp.property} · Cost: <strong>{fmt(exp.amount)}</strong>
                {allocated && <> · {allocated.id} ({allocated.guestName})</>}
                {!exp.bookingId && " · Free-standing"}
              </div>

              {/* Attachments */}
              <Attachments recordType="expense" recordId={exp.id} authUserId={authUser?.id} readOnly={false} />

              {/* Charge field */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#999999", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                  Charge to Owner (£) <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— leave blank to charge the same as cost</span>
                </label>
                <input type="number" step="0.01" value={resolveChargeInput} onChange={e => setResolveChargeInput(e.target.value)}
                  placeholder={`${exp.amount} (same as cost)`}
                  style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E8E8E8", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                {resolveChargeInput && !isNaN(chargeVal) && chargeVal !== exp.amount && (
                  <div style={{ fontSize: 11, color: "#8b5cf6", marginTop: 4 }}>
                    Difference: {fmt(Math.abs(chargeVal - exp.amount))} {chargeVal > exp.amount ? "markup → extra business profit" : "absorbed by business"}
                  </div>
                )}
              </div>

              {/* Business / Owner classification */}
              <div style={{ fontSize: 12, color: "#666666", marginBottom: 12 }}>
                Is this a <strong>business</strong> expense (charge reduces Business Profit) or a <strong>client</strong> expense (charge reduces Client Payout)?
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => resolveExpenseType(exp.id, "business")} style={btn("#8b5cf6", "#fff", false)}>Business Expense</button>
                <button onClick={() => resolveExpenseType(exp.id, "owner")} style={btn("#0891b2", "#fff", false)}>Client Expense</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MOBILE BOTTOM NAV */}
      {isMobile && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0D0D0D", borderTop: "2px solid #E61C5D", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {navTabs.map(t => {
            const icons = { bookings: "📋", dashboard: "📊", expenses: "💸", settings: "⚙️" };
            return (
              <button key={t} onClick={() => { setTab(t); setShowMobileMenu(false); }}
                style={{ flex: 1, padding: "10px 4px 8px", background: "transparent", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 18 }}>{icons[t]}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: tab === t ? "#E61C5D" : "#555", textTransform: "capitalize", letterSpacing: "0.03em" }}>{t}</span>
                {tab === t && <span style={{ width: 16, height: 2, background: "#E61C5D", borderRadius: 1 }}/>}
              </button>
            );
          })}
        </div>
      )}

      {/* Bottom padding so content clears the mobile nav */}
      {isMobile && <div style={{ height: 70 }} />}
    </div>
  );
}
