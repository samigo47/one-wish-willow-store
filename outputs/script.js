const productConfig = {
  productName: "One Wish Willow",
  priceCents: 699,
  maxQuantity: 5,
  standardShippingCents: 400,
  maxQuantityShippingCents: 500,
  cashAppUrl: "https://cash.app/$abath47",
  orderInbox: "onewillowish@gmail.com",
  shopEmail: "shoponewishwillow@gmail.com"
};

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const shippingFor = (qty) => qty >= productConfig.maxQuantity
  ? productConfig.maxQuantityShippingCents
  : productConfig.standardShippingCents;
const orderTotals = (qty = quantity) => {
  const subtotalCents = qty * productConfig.priceCents;
  const shippingCents = shippingFor(qty);
  return {
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents
  };
};
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const error = new Error(`API ${path} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};
const readCart = () => {
  const parsed = Number(localStorage.getItem("owwQuantity"));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, productConfig.maxQuantity) : 1;
};
const writeCart = (quantity) => {
  const safeQuantity = Math.min(Math.max(Number(quantity) || 1, 1), productConfig.maxQuantity);
  localStorage.setItem("owwQuantity", String(safeQuantity));
  renderCart(safeQuantity);
  return safeQuantity;
};

let quantity = readCart();

function renderCart(nextQuantity = quantity) {
  quantity = Math.min(Math.max(nextQuantity, 1), productConfig.maxQuantity);
  document.querySelectorAll("#quantity, [data-cart-quantity], [data-payment-quantity]").forEach((node) => {
    node.textContent = quantity;
  });
  document.querySelectorAll("[data-cart-count]").forEach((node) => {
    node.textContent = quantity;
  });
  const { subtotalCents, shippingCents, totalCents } = orderTotals(quantity);
  document.querySelectorAll("[data-subtotal]").forEach((node) => {
    node.textContent = money(subtotalCents);
  });
  document.querySelectorAll("[data-shipping], [data-payment-shipping]").forEach((node) => {
    node.textContent = `+ ${money(shippingCents)} shipping`;
  });
  document.querySelectorAll("[data-total], [data-payment-total]").forEach((node) => {
    const total = money(totalCents);
    node.textContent = total;
  });
  document.querySelectorAll("[data-cashapp-total]").forEach((node) => {
    node.textContent = money(totalCents);
  });
  document.querySelectorAll("[data-limit-note]").forEach((node) => {
    node.textContent = quantity >= productConfig.maxQuantity
      ? "Limit reached: 5 per order."
      : "Limit 5 per order.";
  });
}

function orderNumber() {
  const existing = localStorage.getItem("owwOrderNumber");
  if (existing) return existing;
  const id = `OWW-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  localStorage.setItem("owwOrderNumber", id);
  return id;
}

function readShipping() {
  try {
    return JSON.parse(localStorage.getItem("owwShipping") || "{}");
  } catch {
    return {};
  }
}

function hasShippingDetails(shipping = readShipping()) {
  return ["name", "email", "address", "city", "state", "zip"].every((key) => String(shipping[key] || "").trim());
}

function renderShippingConfirm() {
  const summary = document.querySelector("[data-shipping-summary]");
  const container = document.querySelector("[data-shipping-confirm]");
  if (!summary || !container) return;
  const shipping = readShipping();
  if (!hasShippingDetails(shipping)) {
    container.classList.add("shipping-missing");
    summary.textContent = "Shipping details are missing. Please go back to checkout and enter name, email, and address before clicking I Paid.";
    return;
  }
  container.classList.remove("shipping-missing");
  summary.textContent = `${shipping.name} | ${shipping.email} | ${shipping.address}, ${shipping.city}, ${shipping.state} ${shipping.zip}`;
}

function buildOrder() {
  const totals = orderTotals(quantity);
  const shipping = readShipping();
  return {
    orderNumber: orderNumber(),
    product: productConfig.productName,
    quantity,
    subtotal: money(totals.subtotalCents),
    shippingCost: money(totals.shippingCents),
    total: money(totals.totalCents),
    customerName: shipping.name || "Not provided",
    customerEmail: shipping.email || "Not provided",
    address: shipping.address || "Not provided",
    city: shipping.city || "Not provided",
    state: shipping.state || "Not provided",
    zip: shipping.zip || "Not provided",
    phone: shipping.phone || "Not provided",
    paymentMethod: "Cash App",
    submittedAt: new Date().toLocaleString()
  };
}

function orderEmailLink(order) {
  const subject = `PAID ORDER ${order.orderNumber} - ${order.total}`;
  const body = [
    "A customer clicked I PAID on the One Wish Willow checkout.",
    "",
    `Order number: ${order.orderNumber}`,
    `Product: ${order.product}`,
    `Quantity: ${order.quantity}`,
    `Subtotal: ${order.subtotal}`,
    `Shipping: ${order.shippingCost}`,
    `Total: ${order.total}`,
    `Payment method: ${order.paymentMethod}`,
    "",
    "Customer details:",
    `Name: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}`,
    `City: ${order.city}`,
    `State: ${order.state}`,
    `ZIP: ${order.zip}`,
    "",
    `Submitted: ${order.submittedAt}`,
    "",
    "Review payment, then approve or reject the order."
  ].join("\n");
  return `mailto:${productConfig.orderInbox}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function submitPaidOrder(order) {
  const result = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify(order)
  });
  return result.order || result;
}

async function fetchOrderStatus(orderNumberValue) {
  return api(`/api/orders/${encodeURIComponent(orderNumberValue)}`);
}

function statusLabel(status) {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "shipped") return "shipped";
  return "pending";
}

function setOrderNumberDisplay(orderNumberValue) {
  const display = document.querySelector("[data-order-number-display]");
  const input = document.querySelector("[data-status-order-input]");
  if (!orderNumberValue) return;
  if (display) display.textContent = orderNumberValue;
  if (input && !input.value) input.value = orderNumberValue;
}

function putOrderNumberInUrl(orderNumberValue) {
  if (!orderNumberValue || !window.history?.replaceState) return;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("order", orderNumberValue);
  window.history.replaceState({}, "", nextUrl);
}

function setupPaymentMode() {
  const body = document.body;
  const qrPanel = document.querySelector("[data-qr-panel]");
  const cashAppButton = document.querySelector(".cashapp-button");
  const showQrButton = document.querySelector("[data-show-qr]");
  if (!qrPanel || !cashAppButton) return;

  const mobileUserAgent = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const uaDataMobile = navigator.userAgentData?.mobile === true;
  const isPhone = mobileUserAgent || uaDataMobile;
  body.classList.toggle("phone-payment", isPhone);
  body.classList.toggle("desktop-payment", !isPhone);
  cashAppButton.href = productConfig.cashAppUrl;

  document.querySelector("[data-cashapp-link]")?.addEventListener("click", () => {
    localStorage.setItem("owwCashAppOpened", "true");
    document.querySelector("[data-paid-button]")?.classList.add("paid-button-ready");
  });

  showQrButton?.addEventListener("click", () => {
    qrPanel.classList.toggle("qr-open");
    showQrButton.textContent = qrPanel.classList.contains("qr-open")
      ? "Hide QR Code"
      : "Show QR Code Instead";
  });
}

function showPaidFlow(state = "pending") {
  const paymentGrid = document.querySelector(".payment-grid");
  const paidFlow = document.querySelector("[data-paid-flow]");
  const title = document.querySelector("[data-paid-title]");
  const message = document.querySelector("[data-paid-message]");
  const statusLine = document.querySelector("[data-order-status-line]");
  const emailButton = document.querySelector("[data-order-email]");
  const errorNode = document.querySelector("[data-submit-error]");
  const orderNumberValue = localStorage.getItem("owwOrderNumber");
  if (!paidFlow || !title || !message) return;

  paymentGrid?.setAttribute("hidden", "");
  paidFlow.removeAttribute("hidden");
  paidFlow.dataset.state = state;
  setOrderNumberDisplay(orderNumberValue);

  if (state === "approved") {
    title.textContent = "Wish Approved";
    message.textContent = "Your payment has been approved. Your One Wish Willow is being prepared for its trip to your doorstep and should be delivered in 3 to 14 business days. Your wish is on the way home.";
    statusLine?.setAttribute("hidden", "");
    emailButton?.setAttribute("hidden", "");
    errorNode?.setAttribute("hidden", "");
  } else if (state === "shipped") {
    title.textContent = "Wish Shipped";
    message.textContent = "Your One Wish Willow has shipped. The wish is officially traveling toward your doorstep.";
    statusLine?.setAttribute("hidden", "");
    emailButton?.setAttribute("hidden", "");
    errorNode?.setAttribute("hidden", "");
  } else if (state === "rejected") {
    title.textContent = "Wish Not Approved";
    message.textContent = "We are sorry, but this order was rejected. Please check that your email, shipping information, and payment screenshot are correct if you want us to review it again.";
    statusLine?.setAttribute("hidden", "");
    emailButton?.setAttribute("hidden", "");
    errorNode?.setAttribute("hidden", "");
  } else {
    title.textContent = "Checking Your Wish";
    message.textContent = "This can take 3 to 10 minutes. Please be patient while the order details are reviewed.";
    statusLine?.removeAttribute("hidden");
    if (statusLine) statusLine.textContent = "Waiting for approval. This page will update automatically.";
    if (emailButton) {
      emailButton.removeAttribute("hidden");
      emailButton.removeAttribute("href");
      emailButton.dataset.emailFallback = "false";
      emailButton.textContent = "Order Saved For Review";
    }
  }
}

function resetPaidFlowToPayment() {
  localStorage.removeItem("owwPaidSubmitted");
  localStorage.removeItem("owwOrderStatus");
  localStorage.removeItem("owwOrderNumber");
  localStorage.removeItem("owwPaidOrder");
  document.querySelector(".payment-grid")?.removeAttribute("hidden");
  document.querySelector("[data-paid-flow]")?.setAttribute("hidden", "");
}

let orderStatusPollTimer;

function startStatusPolling(orderNumberValue) {
  if (!orderNumberValue) return;
  setOrderNumberDisplay(orderNumberValue);
  window.clearTimeout(orderStatusPollTimer);
  const poll = async () => {
    try {
      const result = await fetchOrderStatus(orderNumberValue);
      const status = result.order?.status || result.status;
      if (status === "approved" || status === "rejected" || status === "shipped") {
        localStorage.setItem("owwOrderStatus", status);
        localStorage.setItem("owwOrderNumber", orderNumberValue);
        showPaidFlow(status);
        return;
      }
      const statusLine = document.querySelector("[data-order-status-line]");
      if (statusLine) statusLine.textContent = `Order ${orderNumberValue} is still waiting for review.`;
    } catch (error) {
      if (error.status === 404) {
        resetPaidFlowToPayment();
        return;
      }
      const statusLine = document.querySelector("[data-order-status-line]");
      if (statusLine) statusLine.textContent = "Still checking. If this page is open, it will update when the order is reviewed.";
      orderStatusPollTimer = window.setTimeout(poll, 3000);
      return;
    }
    orderStatusPollTimer = window.setTimeout(poll, 2000);
  };
  orderStatusPollTimer = window.setTimeout(poll, 1000);
}

function setupPaidButton() {
  const paidButton = document.querySelector("[data-paid-button]");
  const emailButton = document.querySelector("[data-order-email]");
  if (!paidButton || !emailButton) return;

  const urlOrderNumber = new URLSearchParams(window.location.search).get("order")?.trim();
  if (urlOrderNumber) {
    const previousOrderNumber = localStorage.getItem("owwOrderNumber");
    localStorage.setItem("owwOrderNumber", urlOrderNumber);
    localStorage.setItem("owwPaidSubmitted", "true");
    if (previousOrderNumber !== urlOrderNumber || !localStorage.getItem("owwOrderStatus")) {
      localStorage.setItem("owwOrderStatus", "pending");
    }
    setOrderNumberDisplay(urlOrderNumber);
  }

  const status = localStorage.getItem("owwOrderStatus");
  const savedOrderNumber = localStorage.getItem("owwOrderNumber");
  const paidSubmitted = localStorage.getItem("owwPaidSubmitted") === "true";
  if (paidSubmitted && (status === "approved" || status === "rejected" || status === "shipped")) {
    showPaidFlow(status);
  } else if (paidSubmitted && status === "pending" && savedOrderNumber) {
    showPaidFlow("pending");
    startStatusPolling(savedOrderNumber);
  } else {
    document.querySelector(".payment-grid")?.removeAttribute("hidden");
    document.querySelector("[data-paid-flow]")?.setAttribute("hidden", "");
  }

  paidButton.addEventListener("click", async () => {
    const shipping = readShipping();
    if (!hasShippingDetails(shipping)) {
      renderShippingConfirm();
      document.querySelector("[data-shipping-confirm]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const order = buildOrder();
    localStorage.setItem("owwPaidOrder", JSON.stringify(order));
    localStorage.setItem("owwOrderStatus", "pending");
    localStorage.setItem("owwPaidSubmitted", "true");
    emailButton.removeAttribute("href");
    emailButton.dataset.emailFallback = "false";
    emailButton.textContent = "Order Saved For Review";
    showPaidFlow("pending");
    const statusLine = document.querySelector("[data-order-status-line]");
    const errorNode = document.querySelector("[data-submit-error]");
    errorNode?.setAttribute("hidden", "");
    if (statusLine) statusLine.textContent = "Submitting your order to ONE WISH WILLOW...";
    try {
      const saved = await submitPaidOrder(order);
      localStorage.setItem("owwPaidOrder", JSON.stringify(saved));
      localStorage.setItem("owwOrderNumber", saved.orderNumber || order.orderNumber);
      setOrderNumberDisplay(saved.orderNumber || order.orderNumber);
      putOrderNumberInUrl(saved.orderNumber || order.orderNumber);
      emailButton.textContent = "Order Saved For Review";
      emailButton.removeAttribute("href");
      emailButton.dataset.emailFallback = "false";
      if (statusLine) statusLine.textContent = `Order ${saved.orderNumber || order.orderNumber} was saved for review. Keep this page open; it will update after approval or rejection.`;
      startStatusPolling(saved.orderNumber || order.orderNumber);
    } catch {
      errorNode?.removeAttribute("hidden");
      if (statusLine) statusLine.textContent = "Order could not reach the backend from this page.";
      emailButton.dataset.emailFallback = "true";
      emailButton.href = orderEmailLink(order);
      emailButton.textContent = "Email Order Details";
      window.setTimeout(() => {
        emailButton.focus();
      }, 450);
    }
  });

  emailButton.addEventListener("click", (event) => {
    if (emailButton.dataset.emailFallback !== "true") {
      event.preventDefault();
      return;
    }
    const order = buildOrder();
    emailButton.href = orderEmailLink(order);
  });

}

function setupAdminPage() {
  const adminOrder = document.querySelector("[data-admin-order]");
  if (!adminOrder) return;
  const adminNotice = document.createElement("p");
  adminNotice.className = "admin-notice";
  adminNotice.setAttribute("aria-live", "polite");
  adminOrder.before(adminNotice);
  const rejectionReasons = [
    "Payment was not found in Cash App.",
    "Payment amount did not match the order total.",
    "Shipping information was missing or incomplete.",
    "Email address could not be verified.",
    "Customer details did not match the payment.",
    "Duplicate or invalid order submission."
  ];

  const renderOrders = (orders) => {
    if (!orders.length) {
      adminOrder.textContent = "No paid orders have been submitted yet.";
      return;
    }
    adminOrder.innerHTML = "";
    orders.forEach((order) => {
      const card = document.createElement("article");
      card.className = "admin-order-card";
      card.innerHTML = `
        <h2>${order.orderNumber}</h2>
        <p><strong>Status:</strong> ${order.status}</p>
        <p><strong>Name:</strong> ${order.customerName}</p>
        <p><strong>Email:</strong> ${order.customerEmail}</p>
        <p><strong>Quantity:</strong> ${order.quantity}</p>
        <p><strong>Total:</strong> ${order.total}</p>
        <p><strong>Address:</strong> ${order.address}, ${order.city}, ${order.state} ${order.zip}</p>
        ${order.reviewReason ? `<p><strong>Review reason:</strong> ${order.reviewReason}</p>` : ""}
        <div class="admin-actions">
          <button class="buy-button" type="button" data-admin-action="approve" data-order-number="${order.orderNumber}">Approve</button>
          <button class="qr-toggle" type="button" data-admin-action="reject" data-order-number="${order.orderNumber}">Reject</button>
          <button class="qr-toggle" type="button" data-admin-action="ship" data-order-number="${order.orderNumber}">Mark Shipped</button>
        </div>
        <div class="reject-reasons" data-reject-panel="${order.orderNumber}" hidden>
          <p>Choose why this order is being rejected:</p>
          ${rejectionReasons.map((reason) => `<button class="qr-toggle" type="button" data-admin-action="reject" data-order-number="${order.orderNumber}" data-reject-reason="${reason}">${reason}</button>`).join("")}
        </div>
      `;
      adminOrder.appendChild(card);
    });
  };

  const render = async () => {
    try {
      const result = await api("/api/orders");
      renderOrders(result.orders || []);
    } catch {
      const raw = localStorage.getItem("owwPaidOrder");
      const status = localStorage.getItem("owwOrderStatus") || "none";
      if (!raw) {
        adminOrder.textContent = "No backend connection yet, and no local paid order has been submitted in this browser.";
        return;
      }
      const order = JSON.parse(raw);
      adminOrder.textContent = JSON.stringify({ status, ...order }, null, 2);
    }
  };

  document.querySelector("[data-approve-order]")?.addEventListener("click", () => {
    localStorage.setItem("owwOrderStatus", "approved");
    render();
  });
  document.querySelector("[data-reject-order]")?.addEventListener("click", () => {
    localStorage.setItem("owwOrderStatus", "rejected");
    render();
  });
  adminOrder.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-admin-action]");
    if (!button) return;
    const action = button.dataset.adminAction;
    const orderNumberValue = button.dataset.orderNumber;
    const rejectionReason = button.dataset.rejectReason || "";
    if (action === "reject" && !rejectionReason) {
      const panel = adminOrder.querySelector(`[data-reject-panel="${orderNumberValue}"]`);
      panel?.toggleAttribute("hidden");
      adminNotice.textContent = `Pick a rejection reason for ${orderNumberValue}.`;
      return;
    }
    button.disabled = true;
    button.textContent = action === "approve" ? "Approving..." : action === "ship" ? "Shipping..." : "Rejecting...";
    try {
      const result = await api(`/api/orders/${encodeURIComponent(orderNumberValue)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectionReason })
      });
      const status = result.order?.status || (action === "approve" ? "approved" : "rejected");
      adminNotice.textContent = `${orderNumberValue} is now ${status}. The customer page will update automatically if it is open.`;
      await render();
    } catch {
      button.disabled = false;
      button.textContent = action === "approve" ? "Approve" : action === "ship" ? "Mark Shipped" : "Reject";
      alert("Backend action failed. Make sure the Python backend server is running.");
    }
  });
  render();
}

function setupLoginPage() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  const nextInput = document.querySelector("[data-login-next]");
  const error = document.querySelector("[data-login-error]");
  if (next && nextInput) nextInput.value = next;
  if (params.get("error") && error) error.removeAttribute("hidden");
}

function setupCopyOrderButtons() {
  document.querySelectorAll("[data-copy-order]").forEach((button) => {
    button.addEventListener("click", async () => {
      const orderNumberValue = localStorage.getItem("owwOrderNumber")
        || document.querySelector("[data-order-number-display]")?.textContent?.trim()
        || "";
      if (!orderNumberValue || orderNumberValue === "Order number pending") return;
      try {
        await navigator.clipboard.writeText(orderNumberValue);
      } catch {
        const helper = document.createElement("textarea");
        helper.value = orderNumberValue;
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      button.classList.add("copied");
      button.setAttribute("aria-label", "Order number copied");
      window.setTimeout(() => {
        button.classList.remove("copied");
        button.setAttribute("aria-label", "Copy order number");
      }, 1400);
    });
  });
}

function renderStatusResult(order, errorMessage = "") {
  const result = document.querySelector("[data-status-result]");
  if (!result) return;
  result.removeAttribute("hidden");
  if (!order) {
    result.dataset.state = "error";
    result.innerHTML = `
      <h2>Order Not Found</h2>
      <p>${errorMessage || "Please check the order number and try again."}</p>
    `;
    return;
  }
  const state = statusLabel(order.status);
  result.dataset.state = state;
  const message = state === "approved"
    ? "Your order has been approved. Your One Wish Willow is on the way to your doorstep."
    : state === "shipped"
      ? "Your order has shipped. Your One Wish Willow is now traveling toward your doorstep."
    : state === "rejected"
      ? `Your order was rejected. ${order.reviewReason || "Please contact support with your order number if you need the review reason."}`
      : "Your order is still waiting for payment review.";
  result.innerHTML = `
    <h2>${state === "approved" ? "Wish Approved" : state === "shipped" ? "Wish Shipped" : state === "rejected" ? "Wish Not Approved" : "Still Reviewing"}</h2>
    <p><strong>Order:</strong> ${order.orderNumber}</p>
    <p><strong>Status:</strong> ${state}</p>
    <p>${message}</p>
  `;
}

function setupStatusPage() {
  const form = document.querySelector("[data-status-form]");
  const input = document.querySelector("[data-status-input]");
  if (!form || !input) return;
  const params = new URLSearchParams(window.location.search);
  const orderFromUrl = params.get("order") || localStorage.getItem("owwOrderNumber") || "";
  if (orderFromUrl) input.value = orderFromUrl;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const orderNumberValue = input.value.trim();
    if (!orderNumberValue) {
      renderStatusResult(null, "Enter your order number first.");
      return;
    }
    const result = document.querySelector("[data-status-result]");
    if (result) {
      result.removeAttribute("hidden");
      result.dataset.state = "pending";
      result.innerHTML = "<h2>Checking</h2><p>Looking up your order now.</p>";
    }
    try {
      const response = await fetchOrderStatus(orderNumberValue);
      renderStatusResult(response.order || response);
    } catch (error) {
      renderStatusResult(null, error.status === 404
        ? "That order number was not found."
        : "Status could not be checked right now. Try again in a moment.");
    }
  });

  if (orderFromUrl) {
    form.dispatchEvent(new Event("submit", { cancelable: true }));
  }
}

function setupVideoPosters() {
  document.querySelectorAll("video[data-autoposter]").forEach((video) => {
    const makePoster = () => {
      if (video.dataset.posterReady === "true" || !video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.poster = canvas.toDataURL("image/jpeg", 0.82);
      video.dataset.posterReady = "true";
      video.currentTime = 0;
    };

    video.addEventListener("loadedmetadata", () => {
      const target = Math.min(1.2, Math.max(0.2, (video.duration || 2) / 6));
      try {
        video.currentTime = target;
      } catch {
        makePoster();
      }
    }, { once: true });
    video.addEventListener("seeked", makePoster, { once: true });
    video.addEventListener("loadeddata", makePoster, { once: true });
  });
}

function setupShortVideoPlayButtons() {
  document.querySelectorAll(".local-video").forEach((card) => {
    const video = card.querySelector("video");
    if (!video || card.querySelector(".short-play-button")) return;
    const button = document.createElement("button");
    button.className = "short-play-button";
    button.type = "button";
    button.setAttribute("aria-label", "Play video");
    card.appendChild(button);

    button.addEventListener("click", () => {
      video.play();
    });
    video.addEventListener("play", () => {
      card.classList.add("is-playing");
    });
    video.addEventListener("pause", () => {
      card.classList.remove("is-playing");
    });
    video.addEventListener("ended", () => {
      card.classList.remove("is-playing");
    });
  });
}

function setupHeroPlayButton() {
  const hero = document.querySelector(".hero-video");
  const iframe = hero?.querySelector("iframe");
  const button = hero?.querySelector(".hero-play-button");
  if (!hero || !iframe || !button) return;
  button.addEventListener("click", () => {
    const url = new URL(iframe.src);
    url.searchParams.set("autoplay", "1");
    iframe.src = url.toString();
    hero.classList.add("is-playing");
  });
}

document.querySelectorAll("[data-qty], [data-cart-qty]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.qty || button.dataset.cartQty;
    const next = action === "increase" ? quantity + 1 : quantity - 1;
    writeCart(next);
  });
});

document.querySelectorAll("[data-checkout-link]").forEach((link) => {
  link.addEventListener("click", () => {
    writeCart(quantity);
  });
});

const shippingForm = document.querySelector("#shipping-form");
if (shippingForm) {
  shippingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(shippingForm);
    const shipping = Object.fromEntries(formData.entries());
    localStorage.setItem("owwShipping", JSON.stringify(shipping));
    localStorage.removeItem("owwPaidSubmitted");
    localStorage.removeItem("owwOrderStatus");
    localStorage.removeItem("owwOrderNumber");
    localStorage.removeItem("owwPaidOrder");
    writeCart(quantity);
    window.location.href = "payment.html";
  });
}

window.addEventListener("load", () => {
  if (window.instgrm?.Embeds) {
    window.instgrm.Embeds.process();
  }
});

renderCart(quantity);
renderShippingConfirm();
setupPaymentMode();
setupVideoPosters();
setupShortVideoPlayButtons();
setupHeroPlayButton();
setupPaidButton();
setupAdminPage();
setupCopyOrderButtons();
setupStatusPage();
setupLoginPage();
