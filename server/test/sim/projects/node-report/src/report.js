// A tiny sales report: the rows every export starts from.

export const rows = [
  { region: 'North', product: 'Widget', units: 12, price: 2.5 },
  { region: 'South', product: 'Widget', units: 7, price: 2.5 },
  { region: 'North', product: 'Gadget', units: 3, price: 10 },
]

export const revenue = (row) => row.units * row.price
