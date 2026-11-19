/** Shared contact helpers so every surface uses the same official details. */

export const DEFAULT_CONTACT = {
  email: 'rifqmuslim@gmail.com',
  phone: '+252612215593',
  whatsapp: '+252612215593',
};

export const digits = (value: string) => String(value || '').replace(/[^\d]/g, '');

export const telHref = (phone: string) => `tel:${digits(phone) ? `+${digits(phone)}` : ''}`;

export const waHref = (phone: string, text?: string) => {
  const number = digits(phone);
  const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${number}${suffix}`;
};

export const mailHref = (email: string, subject?: string) =>
  `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
