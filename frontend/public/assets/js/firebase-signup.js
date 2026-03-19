const signupForm = document.getElementById("signupForm");
const sendEmailCodeBtn = document.getElementById("sendEmailCodeBtn");
const verifyEmailCodeBtn = document.getElementById("verifyEmailCodeBtn");
const createAccountBtn = document.getElementById("createAccountBtn");
const otpInput = document.getElementById("emailOtpCode");
const statusBox = document.getElementById("signupStatus");
const emailInput = signupForm ? signupForm.querySelector('input[name="email"]') : null;

let isEmailOtpVerified = false;

const showStatus = (message, type = "error") => {
  if (!statusBox) return;
  statusBox.style.display = "block";
  statusBox.style.color = type === "success" ? "#22c55e" : "#ef4444";
  statusBox.textContent = message;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const resetOtpVerificationState = () => {
  isEmailOtpVerified = false;
  if (createAccountBtn) createAccountBtn.disabled = true;
};

sendEmailCodeBtn?.addEventListener("click", async () => {
  const email = normalizeEmail(emailInput?.value);
  if (!email) {
    showStatus("Enter your email before requesting OTP.");
    return;
  }

  resetOtpVerificationState();

  try {
    const res = await fetch("/api/email-otp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Failed to send OTP");
    }
    showStatus("5-digit OTP sent to your email.", "success");
  } catch (err) {
    showStatus(err.message || "Failed to send OTP.");
  }
});

verifyEmailCodeBtn?.addEventListener("click", async () => {
  const email = normalizeEmail(emailInput?.value);
  const otp = String(otpInput?.value || "").trim();

  if (!email || !otp) {
    showStatus("Enter email and 5-digit OTP.");
    return;
  }

  if (!/^\d{5}$/.test(otp)) {
    showStatus("OTP must be exactly 5 digits.");
    return;
  }

  try {
    const res = await fetch("/api/email-otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, otp })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "OTP verification failed");
    }

    isEmailOtpVerified = true;
    createAccountBtn.disabled = false;
    showStatus("Email verified. You can now create your account.", "success");
  } catch (err) {
    resetOtpVerificationState();
    showStatus(err.message || "OTP verification failed.");
  }
});

emailInput?.addEventListener("input", () => {
  resetOtpVerificationState();
});

signupForm?.addEventListener("submit", (event) => {
  if (!isEmailOtpVerified) {
    event.preventDefault();
    showStatus("Please verify your email using the 5-digit OTP.");
  }
});
