export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = false;
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}
