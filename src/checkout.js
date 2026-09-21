import "./styles.css";
import "./checkout.css";
import { setupMobileMenu } from "./mobile-menu.js";
import { getCart, subscribeCart } from "./cart.js";

const linesEl = document.querySelector("#checkoutLines");
const totalEl = document.querySelector("#checkoutTotal");
const tableEl = document.querySelector("#checkoutTable");
const emptyEl = document.querySelector("#checkoutEmpty");

function formatMoney(value) {
  return `$${value}`;
}

function renderCheckout() {
  if (!linesEl || !totalEl || !tableEl || !emptyEl) return;

  const cart = getCart();
  totalEl.textContent = formatMoney(cart.total);
  linesEl.replaceChildren();

  const isEmpty = cart.lines.length === 0;
  tableEl.hidden = isEmpty;
  emptyEl.hidden = !isEmpty;
  if (isEmpty) return;

  for (const line of cart.lines) {
    const row = document.createElement("article");
    row.className = "checkout__line";

    const name = document.createElement("span");
    name.className = "checkout__name";
    name.textContent = line.name;

    const qty = document.createElement("span");
    qty.className = "checkout__qty";
    qty.textContent = String(line.qty);

    const price = document.createElement("span");
    price.className = "checkout__price";
    price.textContent = formatMoney(line.lineTotal);

    row.append(name, qty, price);
    linesEl.append(row);
  }
}

renderCheckout();
subscribeCart(renderCheckout);
setupMobileMenu();
