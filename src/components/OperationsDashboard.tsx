import React, { useState } from 'react';
import {
  Building2,
  CalendarDays,
  Camera,
  MapPin,
  PlusCircle,
  ShoppingBag,
  X,
} from 'lucide-react';
import { UserAccount } from '../types/erp';

interface PropertyRecord {
  id: string;
  name: string;
  address: string;
  monthlyRent: number;
  details: string;
}

interface PropertyBookingRecord {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  customerName: string;
  monthlyRent: number;
  processedBy: string;
}

interface JewelryItem {
  id: string;
  sku: string;
  name: string;
  description: string;
  unitCost: number;
  sellingPrice: number;
  quantity: number;
  photos: string[];
}

interface CourtRecord {
  id: string;
  name: string;
  notes: string;
}

interface BookingRecord {
  id: string;
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  customerName: string;
  amount: number;
  processedBy: string;
}

interface JewelrySaleRecord {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  customerName: string;
  soldAt: string;
  processedBy: string;
}

interface OperationsData {
  properties: PropertyRecord[];
  propertyBookings: PropertyBookingRecord[];
  jewelry: JewelryItem[];
  courts: CourtRecord[];
  bookings: BookingRecord[];
  sales: JewelrySaleRecord[];
}

interface Props {
  currentUser: UserAccount;
  onJewelrySale: (itemName: string, quantity: number, amount: number, customerName: string) => void;
  onCourtBooking: (courtName: string, date: string, amount: number, customerName: string) => void;
  onPropertyBooking: (
    propertyName: string,
    address: string,
    startDate: string,
    endDate: string,
    monthlyRent: number,
    customerName: string
  ) => void;
}

const STORAGE_KEY = 'jast-operations-v1';
const TODAY = new Date().toISOString().slice(0, 10);
const EMPTY_DATA: OperationsData = {
  properties: [],
  propertyBookings: [],
  jewelry: [],
  courts: [1, 2, 3, 4].map((number) => ({
    id: `court-${number}`,
    name: `Court ${number}`,
    notes: '',
  })),
  bookings: [],
  sales: [],
};

const newId = () => globalThis.crypto?.randomUUID?.() || `record-${Date.now()}-${Math.random()}`;
const money = (amount: number) => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

function readOperationsData(): { data: OperationsData; error: string } {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return { data: EMPTY_DATA, error: '' };
    const parsed: Partial<OperationsData> = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') throw new Error('Stored data is not an object.');
    return {
      data: {
        properties: Array.isArray(parsed.properties) ? parsed.properties : [],
        propertyBookings: Array.isArray(parsed.propertyBookings) ? parsed.propertyBookings : [],
        jewelry: Array.isArray(parsed.jewelry) ? parsed.jewelry : [],
        courts: Array.isArray(parsed.courts) ? parsed.courts : EMPTY_DATA.courts,
        bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
        sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      },
      error: '',
    };
  } catch (error) {
    return {
      data: EMPTY_DATA,
      error: `Could not load saved operations data: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than the 8 MB limit.`);

  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    image.close();
    throw new Error('The browser could not prepare the selected image.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error(`Could not compress ${file.name}.`));
    }, 'image/jpeg', 0.82);
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error(`Could not read ${file.name}.`));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(blob);
  });
}

export const OperationsDashboard: React.FC<Props> = ({
  currentUser,
  onJewelrySale,
  onCourtBooking,
  onPropertyBooking,
}) => {
  const [initial] = useState(readOperationsData);
  const [data, setData] = useState(initial.data);
  const [message, setMessage] = useState(initial.error);
  const [activeForm, setActiveForm] = useState<'property' | 'propertyBooking' | 'jewelry' | 'court' | 'booking' | 'sale' | null>(null);
  const [photoError, setPhotoError] = useState('');
  const isOwner = currentUser.role === 'owner' && currentUser.id === 'usr-owner-jasmin';
  const allowedBusinesses = currentUser.role === 'owner'
    ? ['real_estate', 'pickleball', 'jewelry']
    : currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : []);
  const canViewProperties = allowedBusinesses.includes('real_estate');
  const canViewCourts = allowedBusinesses.includes('pickleball');
  const canViewJewelry = allowedBusinesses.includes('jewelry');
  const [propertyForm, setPropertyForm] = useState({ name: '', address: '', rent: '', details: '' });
  const [propertyBookingForm, setPropertyBookingForm] = useState({
    propertyId: '',
    startDate: TODAY,
    endDate: '',
    customerName: '',
  });
  const [jewelryForm, setJewelryForm] = useState({
    sku: '',
    name: '',
    description: '',
    cost: '',
    price: '',
    quantity: '1',
    photos: [] as string[],
  });
  const [courtForm, setCourtForm] = useState({ name: '', notes: '' });
  const [bookingForm, setBookingForm] = useState({
    courtId: '',
    date: TODAY,
    startTime: '',
    endTime: '',
    customerName: '',
    amount: '0',
  });
  const [saleForm, setSaleForm] = useState({ itemId: '', quantity: '1', customerName: '' });

  const save = (next: OperationsData) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setData(next);
      setMessage('');
      return true;
    } catch (error) {
      setMessage(`Could not save operations data in this browser: ${error instanceof Error ? error.message : 'storage is unavailable'}`);
      return false;
    }
  };

  const availableFor = (courtId: string, date: string, startTime: string, endTime: string) =>
    !data.bookings.some((booking) =>
      booking.courtId === courtId &&
      booking.date === date &&
      startTime < booking.endTime &&
      endTime > booking.startTime
    );

  const availableCourts = data.courts.filter((court) =>
    !bookingForm.startTime ||
    !bookingForm.endTime ||
    availableFor(court.id, bookingForm.date, bookingForm.startTime, bookingForm.endTime)
  );
  const selectedSaleItem = data.jewelry.find((item) => item.id === saleForm.itemId);
  const saleQuantity = Number(saleForm.quantity);
  const bookingAmount = Number(bookingForm.amount);
  const jewelryTotals = data.jewelry.reduce(
    (totals, item) => ({
      costValue: totals.costValue + item.unitCost * item.quantity,
      sellingValue: totals.sellingValue + item.sellingPrice * item.quantity,
    }),
    { costValue: 0, sellingValue: 0 }
  );
  const jewelrySalesRevenue = data.sales.reduce(
    (total, sale) => total + sale.unitPrice * sale.quantity,
    0
  );
  const selectedProperty = data.properties.find((property) => property.id === propertyBookingForm.propertyId);

  const propertyAvailableFor = (propertyId: string, startDate: string, endDate: string) =>
    !data.propertyBookings.some((booking) =>
      booking.propertyId === propertyId &&
      startDate <= booking.endDate &&
      endDate >= booking.startDate
    );

  const availableProperties = data.properties.filter((property) =>
    !propertyBookingForm.endDate ||
    propertyAvailableFor(property.id, propertyBookingForm.startDate, propertyBookingForm.endDate)
  );

  const handlePhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPhotoError('');
    try {
      const photos = await Promise.all(Array.from(files).map(compressPhoto));
      setJewelryForm((form) => ({ ...form, photos: [...form.photos, ...photos] }));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Could not load the selected images.');
    }
  };

  const addProperty = () => {
    const rent = Number(propertyForm.rent);
    if (!propertyForm.name.trim() || !propertyForm.address.trim() || !propertyForm.rent.trim() ||
      !Number.isFinite(rent) || rent < 0) {
      setMessage('Enter a property name, address, and a valid non-negative monthly rent.');
      return;
    }
    if (save({
      ...data,
      properties: [{
        id: newId(),
        name: propertyForm.name.trim(),
        address: propertyForm.address.trim(),
        monthlyRent: rent,
        details: propertyForm.details.trim(),
      }, ...data.properties],
    })) {
      setPropertyForm({ name: '', address: '', rent: '', details: '' });
      setActiveForm(null);
    }
  };

  const addPropertyBooking = () => {
    const property = data.properties.find((item) => item.id === propertyBookingForm.propertyId);
    if (!property || !propertyBookingForm.startDate || !propertyBookingForm.endDate ||
      propertyBookingForm.startDate < TODAY || propertyBookingForm.endDate < propertyBookingForm.startDate) {
      setMessage('Select a property and valid lease start and end dates (start date must be today or later).');
      return;
    }
    if (!propertyAvailableFor(property.id, propertyBookingForm.startDate, propertyBookingForm.endDate)) {
      setMessage('This property already has a booking during those dates. Choose another property or date range.');
      return;
    }
    const booking: PropertyBookingRecord = {
      id: newId(),
      propertyId: property.id,
      startDate: propertyBookingForm.startDate,
      endDate: propertyBookingForm.endDate,
      customerName: propertyBookingForm.customerName.trim() || 'Walk-in Customer',
      monthlyRent: property.monthlyRent,
      processedBy: currentUser.name,
    };
    if (save({ ...data, propertyBookings: [booking, ...data.propertyBookings] })) {
      onPropertyBooking(
        property.name,
        property.address,
        booking.startDate,
        booking.endDate,
        booking.monthlyRent,
        booking.customerName
      );
      setPropertyBookingForm({ propertyId: '', startDate: TODAY, endDate: '', customerName: '' });
      setActiveForm(null);
    }
  };

  const addJewelry = () => {
    const unitCost = Number(jewelryForm.cost);
    const sellingPrice = Number(jewelryForm.price);
    const quantity = Number(jewelryForm.quantity);
    if (!jewelryForm.sku.trim() || !jewelryForm.name.trim() || !jewelryForm.photos.length ||
      !jewelryForm.cost.trim() || !jewelryForm.price.trim() ||
      !Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(sellingPrice) || sellingPrice <= 0 ||
      !Number.isInteger(quantity) || quantity < 0) {
      setMessage('Enter the SKU, item name, at least one photo, valid cost and selling price, and whole-number stock.');
      return;
    }
    if (data.jewelry.some((item) => item.sku.toLowerCase() === jewelryForm.sku.trim().toLowerCase())) {
      setMessage('That jewelry SKU already exists. Enter a unique SKU.');
      return;
    }
    if (save({
      ...data,
      jewelry: [{
        id: newId(),
        sku: jewelryForm.sku.trim(),
        name: jewelryForm.name.trim(),
        description: jewelryForm.description.trim(),
        unitCost,
        sellingPrice,
        quantity,
        photos: jewelryForm.photos,
      }, ...data.jewelry],
    })) {
      setJewelryForm({ sku: '', name: '', description: '', cost: '', price: '', quantity: '1', photos: [] });
      setActiveForm(null);
    }
  };

  const addCourt = () => {
    if (!courtForm.name.trim()) {
      setMessage('Enter a name for the pickleball court.');
      return;
    }
    if (data.courts.some((court) => court.name.toLowerCase() === courtForm.name.trim().toLowerCase())) {
      setMessage('A court with that name already exists.');
      return;
    }
    if (save({
      ...data,
      courts: [{ id: newId(), name: courtForm.name.trim(), notes: courtForm.notes.trim() }, ...data.courts],
    })) {
      setCourtForm({ name: '', notes: '' });
      setActiveForm(null);
    }
  };

  const addBooking = () => {
    const court = data.courts.find((item) => item.id === bookingForm.courtId);
    if (!court || !bookingForm.date || bookingForm.date < TODAY ||
      !bookingForm.startTime || !bookingForm.endTime || !bookingForm.amount.trim() ||
      bookingForm.endTime <= bookingForm.startTime || !Number.isFinite(bookingAmount) || bookingAmount < 0) {
      setMessage('Select a court, date, valid start and end times, and a non-negative booking amount.');
      return;
    }
    if (!availableFor(court.id, bookingForm.date, bookingForm.startTime, bookingForm.endTime)) {
      setMessage('That court already has a booking during this time. Choose another court or time.');
      return;
    }
    const booking: BookingRecord = {
      id: newId(),
      courtId: court.id,
      date: bookingForm.date,
      startTime: bookingForm.startTime,
      endTime: bookingForm.endTime,
      customerName: bookingForm.customerName.trim() || 'Walk-in Customer',
      amount: bookingAmount,
      processedBy: currentUser.name,
    };
    if (save({ ...data, bookings: [booking, ...data.bookings] })) {
      onCourtBooking(court.name, booking.date, booking.amount, booking.customerName);
      setBookingForm({ courtId: '', date: TODAY, startTime: '', endTime: '', customerName: '', amount: '0' });
      setActiveForm(null);
    }
  };

  const processSale = () => {
    if (!selectedSaleItem || !Number.isInteger(saleQuantity) || saleQuantity < 1 ||
      saleQuantity > selectedSaleItem.quantity) {
      setMessage('Select an in-stock jewelry item and enter a valid quantity not exceeding available stock.');
      return;
    }
    const sale: JewelrySaleRecord = {
      id: newId(),
      itemId: selectedSaleItem.id,
      itemName: selectedSaleItem.name,
      quantity: saleQuantity,
      unitPrice: selectedSaleItem.sellingPrice,
      customerName: saleForm.customerName.trim() || 'Walk-in Customer',
      soldAt: new Date().toISOString(),
      processedBy: currentUser.name,
    };
    const next = {
      ...data,
      jewelry: data.jewelry.map((item) =>
        item.id === selectedSaleItem.id ? { ...item, quantity: item.quantity - saleQuantity } : item
      ),
      sales: [sale, ...data.sales],
    };
    if (save(next)) {
      onJewelrySale(sale.itemName, sale.quantity, sale.unitPrice * sale.quantity, sale.customerName);
      setSaleForm({ itemId: '', quantity: '1', customerName: '' });
      setActiveForm(null);
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  const labelClass = 'mb-1 block text-xs font-semibold text-slate-600';
  const canEditCatalog = isOwner;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Business Operations</h2>
        <p className="mt-1 text-xs text-slate-500">
          Properties, court availability, jewelry stock, bookings, and sales.
          {isOwner
            ? ' Only Ma’am Jasmin Taurak can add catalog records.'
            : ' Catalog records are read-only; bookings and jewelry sales are enabled for your staff account.'}
        </p>
      </div>

      {message && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{message}</span>
          <button onClick={() => setMessage('')} aria-label="Dismiss message"><X className="h-4 w-4" /></button>
        </div>
      )}

      {canViewProperties && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-indigo-600" />
              <div>
                <h3 className="font-bold text-slate-900">Real Estate Properties</h3>
                <p className="text-xs text-slate-500">{data.properties.length} properties</p>
              </div>
            </div>
            {canEditCatalog && <button onClick={() => setActiveForm(activeForm === 'property' ? null : 'property')} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"><PlusCircle className="h-4 w-4" /> Add property</button>}
          </div>
          {activeForm === 'property' && canEditCatalog && (
            <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <label><span className={labelClass}>Property name</span><input className={inputClass} value={propertyForm.name} onChange={(e) => setPropertyForm({ ...propertyForm, name: e.target.value })} /></label>
              <label><span className={labelClass}>Monthly rent (PHP)</span><input type="number" min="0" className={inputClass} value={propertyForm.rent} onChange={(e) => setPropertyForm({ ...propertyForm, rent: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Street address</span><input className={inputClass} value={propertyForm.address} onChange={(e) => setPropertyForm({ ...propertyForm, address: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Notes (optional)</span><input className={inputClass} value={propertyForm.details} onChange={(e) => setPropertyForm({ ...propertyForm, details: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-2"><button onClick={addProperty} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Save property</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
            </div>
          )}
          {data.properties.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {data.properties.map((property) => (
                <article key={property.id} className="rounded-xl border border-slate-200 p-4">
                  <h4 className="font-semibold text-slate-900">{property.name}</h4>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{property.address}</p>
                  <p className="mt-3 text-sm font-bold text-indigo-700">{money(property.monthlyRent)} <span className="text-xs font-normal text-slate-500">/ month</span></p>
                  {property.details && <p className="mt-1 text-xs text-slate-500">{property.details}</p>}
                </article>
              ))}
            </div>
          ) : <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No properties listed yet.</p>}
          {data.properties.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800">Process a property booking</h4>
                <button onClick={() => setActiveForm(activeForm === 'propertyBooking' ? null : 'propertyBooking')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"><PlusCircle className="h-3.5 w-3.5" /> New property booking</button>
              </div>
              {activeForm === 'propertyBooking' && (
                <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label><span className={labelClass}>Move-in date</span><input type="date" min={TODAY} className={inputClass} value={propertyBookingForm.startDate} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, startDate: e.target.value })} /></label>
                  <label><span className={labelClass}>Lease end date</span><input type="date" min={propertyBookingForm.startDate} className={inputClass} value={propertyBookingForm.endDate} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, endDate: e.target.value })} /></label>
                  <label><span className={labelClass}>Available property</span><select className={inputClass} value={propertyBookingForm.propertyId} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, propertyId: e.target.value })}><option value="">Select a property</option>{availableProperties.map((property) => <option key={property.id} value={property.id}>{property.name} — {money(property.monthlyRent)}/month</option>)}</select></label>
                  <label><span className={labelClass}>Customer / tenant name</span><input className={inputClass} value={propertyBookingForm.customerName} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, customerName: e.target.value })} /></label>
                  <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
                    <span className="text-xs text-slate-600">Monthly rent: <strong>{money(selectedProperty?.monthlyRent || 0)}</strong></span>
                    <div className="flex gap-2"><button onClick={addPropertyBooking} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Save property booking</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
                  </div>
                </div>
              )}
              {data.propertyBookings.length > 0 && <div className="mt-3 divide-y divide-slate-100">{data.propertyBookings.map((booking) => <div key={booking.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span className="font-semibold text-slate-800">{data.properties.find((property) => property.id === booking.propertyId)?.name || 'Property'} • {booking.startDate} to {booking.endDate}</span><span className="text-slate-500">{booking.customerName} • {money(booking.monthlyRent)}/month • {booking.processedBy}</span></div>)}</div>}
            </div>
          )}
        </section>
      )}

      {canViewCourts && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-600" />
              <div>
                <h3 className="font-bold text-slate-900">Pickleball Courts & Bookings</h3>
                <p className="text-xs text-slate-500">{availableCourts.length} courts available for selected booking time</p>
              </div>
            </div>
            {canEditCatalog && <button onClick={() => setActiveForm(activeForm === 'court' ? null : 'court')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><PlusCircle className="h-4 w-4" /> Add court</button>}
          </div>
          {activeForm === 'court' && canEditCatalog && (
            <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <label><span className={labelClass}>Court name or number</span><input className={inputClass} value={courtForm.name} onChange={(e) => setCourtForm({ ...courtForm, name: e.target.value })} placeholder="Court 5" /></label>
              <label><span className={labelClass}>Notes (optional)</span><input className={inputClass} value={courtForm.notes} onChange={(e) => setCourtForm({ ...courtForm, notes: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-2"><button onClick={addCourt} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">Save court</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.courts.map((court) => {
              const isAvailable = !bookingForm.startTime || !bookingForm.endTime ||
                availableFor(court.id, bookingForm.date, bookingForm.startTime, bookingForm.endTime);
              return <article key={court.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-900">{court.name}</h4>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>{isAvailable ? 'Available' : 'Booked'}</span>
                </div>
                {court.notes && <p className="mt-1 text-xs text-slate-500">{court.notes}</p>}
              </article>;
            })}
          </div>
          {data.courts.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No courts added yet.</p>}
          {data.courts.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800">Process a court booking</h4>
                <button onClick={() => setActiveForm(activeForm === 'booking' ? null : 'booking')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"><PlusCircle className="h-3.5 w-3.5" /> New booking</button>
              </div>
              {activeForm === 'booking' && (
                <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label><span className={labelClass}>Date</span><input type="date" min={TODAY} className={inputClass} value={bookingForm.date} onChange={(e) => setBookingForm({ ...bookingForm, date: e.target.value })} /></label>
                  <label><span className={labelClass}>Start time</span><input type="time" className={inputClass} value={bookingForm.startTime} onChange={(e) => setBookingForm({ ...bookingForm, startTime: e.target.value })} /></label>
                  <label><span className={labelClass}>End time</span><input type="time" className={inputClass} value={bookingForm.endTime} onChange={(e) => setBookingForm({ ...bookingForm, endTime: e.target.value })} /></label>
                  <label><span className={labelClass}>Available court</span><select className={inputClass} value={bookingForm.courtId} onChange={(e) => setBookingForm({ ...bookingForm, courtId: e.target.value })}><option value="">Select a court</option>{availableCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
                  <label><span className={labelClass}>Customer name</span><input className={inputClass} value={bookingForm.customerName} onChange={(e) => setBookingForm({ ...bookingForm, customerName: e.target.value })} /></label>
                  <label><span className={labelClass}>Booking amount (PHP; 0 if unpaid)</span><input type="number" min="0" className={inputClass} value={bookingForm.amount} onChange={(e) => setBookingForm({ ...bookingForm, amount: e.target.value })} /></label>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button onClick={addBooking} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">Save booking</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
                </div>
              )}
              {data.bookings.length > 0 && <div className="mt-3 divide-y divide-slate-100">{data.bookings.map((booking) => <div key={booking.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span className="font-semibold text-slate-800">{data.courts.find((court) => court.id === booking.courtId)?.name || 'Court'} • {booking.date} • {booking.startTime}–{booking.endTime}</span><span className="text-slate-500">{booking.customerName} • {money(booking.amount)} • {booking.processedBy}</span></div>)}</div>}
            </div>
          )}
        </section>
      )}

      {canViewJewelry && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-amber-600" />
              <div>
                <h3 className="font-bold text-slate-900">Jewelry Inventory</h3>
                <p className="text-xs text-slate-500">{data.jewelry.reduce((sum, item) => sum + item.quantity, 0)} pieces in stock across {data.jewelry.length} items</p>
              </div>
            </div>
            {canEditCatalog && <button onClick={() => setActiveForm(activeForm === 'jewelry' ? null : 'jewelry')} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white"><PlusCircle className="h-4 w-4" /> Add jewelry</button>}
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">CURRENT INVENTORY COST</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{money(jewelryTotals.costValue)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Unit cost × current stock</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">CURRENT SELLING VALUE</p>
              <p className="mt-1 text-lg font-bold text-indigo-700">{money(jewelryTotals.sellingValue)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Selling price × current stock</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700">RECORDED SALES REVENUE</p>
              <p className="mt-1 text-lg font-bold text-emerald-800">{money(jewelrySalesRevenue)}</p>
              <p className="mt-1 text-[11px] text-emerald-700">Total from completed jewelry sales</p>
            </div>
          </div>
          {activeForm === 'jewelry' && canEditCatalog && (
            <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <label><span className={labelClass}>SKU</span><input className={inputClass} value={jewelryForm.sku} onChange={(e) => setJewelryForm({ ...jewelryForm, sku: e.target.value })} /></label>
              <label><span className={labelClass}>Item name</span><input className={inputClass} value={jewelryForm.name} onChange={(e) => setJewelryForm({ ...jewelryForm, name: e.target.value })} /></label>
              <label><span className={labelClass}>Quantity in stock</span><input type="number" min="0" step="1" className={inputClass} value={jewelryForm.quantity} onChange={(e) => setJewelryForm({ ...jewelryForm, quantity: e.target.value })} /></label>
              <label><span className={labelClass}>Unit cost (PHP)</span><input type="number" min="0" step="0.01" className={inputClass} value={jewelryForm.cost} onChange={(e) => setJewelryForm({ ...jewelryForm, cost: e.target.value })} /></label>
              <label><span className={labelClass}>Selling price per unit (PHP)</span><input type="number" min="0" step="0.01" className={inputClass} value={jewelryForm.price} onChange={(e) => setJewelryForm({ ...jewelryForm, price: e.target.value })} /></label>
              <label><span className={labelClass}>Description (optional)</span><input className={inputClass} value={jewelryForm.description} onChange={(e) => setJewelryForm({ ...jewelryForm, description: e.target.value })} /></label>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelClass}>Jewelry photos (multiple images allowed)</label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><Camera className="h-4 w-4" /> Choose images<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void handlePhotos(e.target.files); e.currentTarget.value = ''; }} /></label>
                {photoError && <p role="alert" className="mt-2 text-xs text-rose-700">{photoError}</p>}
                {jewelryForm.photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{jewelryForm.photos.map((photo, index) => <div key={`${index}-${photo.slice(0, 24)}`} className="relative"><img src={photo} alt={`Jewelry upload ${index + 1}`} className="h-16 w-16 rounded-lg object-cover" /><button aria-label={`Remove photo ${index + 1}`} onClick={() => setJewelryForm({ ...jewelryForm, photos: jewelryForm.photos.filter((_, photoIndex) => photoIndex !== index) })} className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-0.5 text-white"><X className="h-3 w-3" /></button></div>)}</div>}
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button onClick={addJewelry} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white">Save inventory item</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
            </div>
          )}
          {canViewJewelry && data.jewelry.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.jewelry.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-xl border border-slate-200">
                  {item.photos.length > 0 && <div className="flex gap-1 overflow-x-auto bg-slate-100 p-1">{item.photos.map((photo, index) => <img key={index} src={photo} alt={`${item.name} ${index + 1}`} className="h-40 min-w-0 flex-1 object-cover" />)}</div>}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2"><div><h4 className="font-semibold text-slate-900">{item.name}</h4><p className="text-[11px] text-slate-500">SKU {item.sku}</p></div><span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">{item.quantity} in stock</span></div>
                    {item.description && <p className="mt-2 text-xs text-slate-500">{item.description}</p>}
                    <div className="mt-3 flex justify-between gap-2 text-xs"><span className="text-slate-500">Unit cost: {money(item.unitCost)}</span><strong className="text-slate-900">Sell: {money(item.sellingPrice)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {data.jewelry.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No jewelry inventory listed yet.</p>}
          {data.jewelry.some((item) => item.quantity > 0) && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-800">Process a jewelry sale</h4>
                <button onClick={() => setActiveForm(activeForm === 'sale' ? null : 'sale')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"><PlusCircle className="h-3.5 w-3.5" /> New sale</button>
              </div>
              {activeForm === 'sale' && (
                <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label><span className={labelClass}>Jewelry item</span><select className={inputClass} value={saleForm.itemId} onChange={(e) => setSaleForm({ ...saleForm, itemId: e.target.value })}><option value="">Select an item</option>{data.jewelry.filter((item) => item.quantity > 0).map((item) => <option key={item.id} value={item.id}>{item.name} — {item.quantity} in stock</option>)}</select></label>
                  <label><span className={labelClass}>Quantity</span><input type="number" min="1" max={selectedSaleItem?.quantity || 1} step="1" className={inputClass} value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} /></label>
                  <label><span className={labelClass}>Customer name</span><input className={inputClass} value={saleForm.customerName} onChange={(e) => setSaleForm({ ...saleForm, customerName: e.target.value })} /></label>
                  <div><span className={labelClass}>Sale total</span><p className="py-2 text-sm font-bold text-emerald-700">{money((selectedSaleItem?.sellingPrice || 0) * (Number.isFinite(saleQuantity) ? saleQuantity : 0))}</p></div>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-4"><button onClick={processSale} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white">Complete sale & update stock</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
                </div>
              )}
              {data.sales.length > 0 && <div className="mt-3 divide-y divide-slate-100">{data.sales.map((sale) => <div key={sale.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span className="font-semibold text-slate-800">{sale.itemName} × {sale.quantity} • {money(sale.unitPrice * sale.quantity)}</span><span className="text-slate-500">{sale.customerName} • {new Date(sale.soldAt).toLocaleString()} • {sale.processedBy}</span></div>)}</div>}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
