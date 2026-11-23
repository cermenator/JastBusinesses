import React, { useEffect, useState } from 'react';
import {
  Building2,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  MapPin,
  Pencil,
  PlusCircle,
  RotateCcw,
  ShoppingBag,
  Ban,
  X,
} from 'lucide-react';
import { UserAccount } from '../types/erp';
import { supabase } from '../lib/supabaseClient';

interface PropertyRecord {
  id: string;
  name: string;
  address: string;
  monthlyRent: number;
  details: string;
  photos: string[];
  photoPaths: string[];
}

interface PropertyBookingRecord {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string | null;
  customerName: string;
  monthlyRent: number;
  depositAmount: number;
  processedBy: string;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'checked_out';
}

interface PropertyPaymentRecord {
  id: string;
  bookingId: string;
  amount: number;
  rentAmount: number;
  depositAmount: number;
  receivedOn: string;
  recordedBy: string;
  status: 'pending_confirmation' | 'confirmed' | 'rejected';
}

interface PropertyCheckoutRecord {
  id: string;
  bookingId: string;
  damageAmount: number;
  depositRefund: number | null;
  inspectionNotes: string;
  recordedBy: string;
  status: 'pending_owner_approval' | 'approved' | 'rejected';
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
  photoPaths: string[];
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
  status: 'confirmed' | 'cancelled';
}

interface JewelrySaleRecord {
  id: string;
  transactionId: string | null;
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  customerName: string;
  soldAt: string;
  processedBy: string;
  returned: boolean;
}

interface OperationsData {
  properties: PropertyRecord[];
  propertyBookings: PropertyBookingRecord[];
  propertyPayments: PropertyPaymentRecord[];
  propertyCheckouts: PropertyCheckoutRecord[];
  jewelry: JewelryItem[];
  courts: CourtRecord[];
  bookings: BookingRecord[];
  sales: JewelrySaleRecord[];
}

interface Props {
  currentUser: UserAccount;
  authUserId: string;
  refreshKey: number;
  onJewelrySale: (itemId: string, quantity: number, customerName: string) => Promise<string | null>;
  onCourtBooking: (courtName: string, date: string, amount: number, customerName: string) => Promise<boolean>;
  onJewelryReturn: () => void;
}

const TODAY = new Date().toISOString().slice(0, 10);
const EMPTY_DATA: OperationsData = {
  properties: [],
  propertyBookings: [],
  propertyPayments: [],
  propertyCheckouts: [],
  jewelry: [],
  courts: [],
  bookings: [],
  sales: [],
};

function addOneDay(date: string): string {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

function formatBookingDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function isJewelrySaleReturnEligible(soldAt: string): boolean {
  const soldAtTime = new Date(soldAt).getTime();
  return Number.isFinite(soldAtTime) && Date.now() <= soldAtTime + 7 * 24 * 60 * 60 * 1000;
}

function jewelryReturnDeadline(soldAt: string): string {
  return new Date(new Date(soldAt).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleString('en-PH');
}

function propertyBookingStatus(bookings: PropertyBookingRecord[], propertyId: string) {
  const upcoming = bookings
    .filter((booking) =>
      (booking.status === 'pending_payment' || booking.status === 'confirmed') &&
      booking.propertyId === propertyId &&
      (!booking.endDate || booking.endDate >= TODAY)
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ranges = upcoming.reduce<Array<{ startDate: string; endDate: string }>>((merged, booking) => {
    const lastRange = merged[merged.length - 1];
    const endDate = booking.endDate || '9999-12-31';
    if (lastRange && (
      lastRange.endDate === '9999-12-31' ||
      booking.startDate <= addOneDay(lastRange.endDate)
    )) {
      if (endDate > lastRange.endDate) lastRange.endDate = endDate;
    } else {
      merged.push({ startDate: booking.startDate, endDate });
    }
    return merged;
  }, []);

  const currentBooking = ranges.find((range) => range.startDate <= TODAY && range.endDate >= TODAY);
  if (currentBooking) {
    const activeBooking = upcoming.find((booking) =>
      booking.startDate <= TODAY && (booking.endDate === null || booking.endDate >= TODAY)
    );
    if (activeBooking?.status === 'pending_payment') {
      return { label: 'Pending payment', detail: 'Reserved; awaiting owner payment confirmation', isBooked: true };
    }
    return {
      label: currentBooking.endDate === '9999-12-31' ? 'Occupied' : 'Booked',
      detail: currentBooking.endDate === '9999-12-31'
        ? 'Open-ended stay'
        : `Available from ${formatBookingDate(addOneDay(currentBooking.endDate))}`,
      isBooked: true,
    };
  }

  const nextBooking = ranges[0];
  if (nextBooking) {
    return {
      label: 'Available now',
      detail: `Next booked ${formatBookingDate(nextBooking.startDate)}–${formatBookingDate(nextBooking.endDate)} · available again ${formatBookingDate(addOneDay(nextBooking.endDate))}`,
      isBooked: false,
    };
  }

  return { label: 'Available', detail: 'Available now · no upcoming bookings', isBooked: false };
}

const newId = () => globalThis.crypto?.randomUUID?.() || `record-${Date.now()}-${Math.random()}`;
const money = (amount: number) => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

function propertyRentBalance(
  booking: PropertyBookingRecord,
  payments: PropertyPaymentRecord[],
  asOf = TODAY
) {
  const confirmedPayments = payments.filter(
    (payment) => payment.bookingId === booking.id && payment.status === 'confirmed'
  );
  const rentPaid = cents(confirmedPayments.reduce((sum, payment) => sum + payment.rentAmount, 0));
  const depositPaid = cents(confirmedPayments.reduce((sum, payment) => sum + payment.depositAmount, 0));
  const endDate = booking.endDate && booking.endDate < asOf ? booking.endDate : asOf;
  const periods: Array<{ dueDate: string; amount: number }> = [];
  const start = new Date(`${booking.startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if ((booking.status === 'confirmed' || booking.status === 'checked_out') && start <= end) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end) {
      const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      const occupiedStart = start > monthStart ? start : monthStart;
      const bookingEnd = booking.endDate
        ? new Date(`${booking.endDate}T00:00:00.000Z`)
        : monthEnd;
      const occupiedEnd = bookingEnd < monthEnd ? bookingEnd : monthEnd;
      const dueDate = cursor.getTime() === Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
        ? booking.startDate
        : monthStart.toISOString().slice(0, 10);
      if (occupiedStart <= occupiedEnd && dueDate <= asOf) {
        const occupiedDays = Math.floor((occupiedEnd.getTime() - occupiedStart.getTime()) / 86400000) + 1;
        const daysInMonth = monthEnd.getUTCDate();
        periods.push({ dueDate, amount: cents(booking.monthlyRent * occupiedDays / daysInMonth) });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  const rentBilled = cents(periods.reduce((sum, period) => sum + period.amount, 0));
  const nextRentDueCandidate = booking.startDate > asOf
    ? booking.startDate
    : new Date(Date.UTC(
      new Date(`${asOf}T00:00:00.000Z`).getUTCFullYear(),
      new Date(`${asOf}T00:00:00.000Z`).getUTCMonth() + 1,
      1
    )).toISOString().slice(0, 10);
  const nextRentDueDate = booking.status === 'confirmed' &&
    (!booking.endDate || nextRentDueCandidate <= booking.endDate)
    ? nextRentDueCandidate
    : null;
  let remainingPaid = rentPaid;
  let firstUnpaid: { dueDate: string; amount: number } | null = null;
  let overdueBalance = 0;
  for (const period of periods) {
    const unpaid = cents(Math.max(0, period.amount - remainingPaid));
    remainingPaid = cents(Math.max(0, remainingPaid - period.amount));
    if (unpaid > 0) {
      firstUnpaid ||= { dueDate: period.dueDate, amount: unpaid };
      if (period.dueDate < asOf) overdueBalance = cents(overdueBalance + unpaid);
    }
  }
  const daysOverdue = firstUnpaid && firstUnpaid.dueDate < asOf
    ? Math.floor((
      new Date(`${asOf}T00:00:00.000Z`).getTime() -
      new Date(`${firstUnpaid.dueDate}T00:00:00.000Z`).getTime()
    ) / 86400000)
    : 0;

  return {
    rentPaid,
    depositPaid,
    rentBilled,
    rentBalance: cents(rentBilled - rentPaid),
    rentAdvance: cents(Math.max(0, rentPaid - rentBilled)),
    depositBalance: cents(Math.max(0, booking.depositAmount - depositPaid)),
    overdueBalance,
    firstUnpaid,
    daysOverdue,
    nextRentDueDate,
    daysUntilNextRent: nextRentDueDate
      ? Math.max(0, Math.floor((
        new Date(`${nextRentDueDate}T00:00:00.000Z`).getTime() -
        new Date(`${asOf}T00:00:00.000Z`).getTime()
      ) / 86400000))
      : null,
  };
}

async function signedPhotoUrls(bucket: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
  if (error) throw new Error(`Could not load photos from ${bucket}: ${error.message}`);
  return data.map((item) => {
    if (!item.signedUrl) throw new Error(`Could not create a view link for a photo in ${bucket}.`);
    return item.signedUrl;
  });
}

async function saveCatalogPhotos(
  bucket: string,
  userId: string,
  photos: string[],
  previousPhotos: string[] = [],
  previousPaths: string[] = []
): Promise<string[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const paths: string[] = [];
  for (const photo of photos) {
    if (photo.startsWith('data:image/')) {
      const response = await fetch(photo);
      if (!response.ok) throw new Error('Could not prepare an uploaded catalog photo.');
      const blob = await response.blob();
      const path = `${userId}/${newId()}.jpg`;
      const { error } = await supabase.storage.from(bucket).upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) throw new Error(`Could not upload a catalog photo: ${error.message}`);
      paths.push(path);
      continue;
    }

    const previousIndex = previousPhotos.indexOf(photo);
    const existingPath = previousIndex >= 0 ? previousPaths[previousIndex] : undefined;
    if (!existingPath) throw new Error('A retained photo could not be matched to its Supabase storage object.');
    paths.push(existingPath);
  }
  return paths;
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
  authUserId,
  refreshKey,
  onJewelrySale,
  onCourtBooking,
  onJewelryReturn,
}) => {
  const [data, setData] = useState(EMPTY_DATA);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [returningSaleId, setReturningSaleId] = useState<string | null>(null);
  const [dismissedReturnActionIds, setDismissedReturnActionIds] = useState<Set<string>>(() => new Set());
  const [photoPreview, setPhotoPreview] = useState<{ itemId: string; photoIndex: number } | null>(null);
  const [propertyPreview, setPropertyPreview] = useState<{ propertyId: string; photoIndex: number } | null>(null);
  const [activeForm, setActiveForm] = useState<'property' | 'propertyBooking' | 'jewelry' | 'court' | 'booking' | 'sale' | null>(null);
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [paymentBookingId, setPaymentBookingId] = useState<string | null>(null);
  const [savingPropertyPaymentId, setSavingPropertyPaymentId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', rentAmount: '', depositAmount: '' });
  const [checkoutBookingId, setCheckoutBookingId] = useState<string | null>(null);
  const [checkoutForm, setCheckoutForm] = useState({ damageAmount: '0', inspectionNotes: '' });
  const isOwner = currentUser.role === 'owner';
  const allowedBusinesses = currentUser.role === 'owner'
    ? ['real_estate', 'pickleball', 'jewelry']
    : currentUser.businessIds || (currentUser.businessId ? [currentUser.businessId] : []);
  const canViewProperties = allowedBusinesses.includes('real_estate');
  const canViewCourts = allowedBusinesses.includes('pickleball');
  const canViewJewelry = allowedBusinesses.includes('jewelry');
  const [propertyForm, setPropertyForm] = useState({
    name: '',
    address: '',
    rent: '',
    details: '',
    photos: [] as string[],
  });
  const [propertyBookingForm, setPropertyBookingForm] = useState({
    propertyId: '',
    startDate: TODAY,
    endDate: '',
    openEnded: true,
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

  const refreshData = async () => {
    if (!supabase) {
      setMessage('Supabase is not configured.');
      setLoading(false);
      return false;
    }
    setLoading(true);
    try {
      const [
        propertyResult,
        propertyBookingResult,
        propertyPaymentResult,
        propertyCheckoutResult,
        jewelryResult,
        courtResult,
        bookingResult,
        saleResult,
        returnResult,
      ] = await Promise.all([
        supabase.from('properties').select('*').order('created_at', { ascending: false }),
        supabase.from('property_bookings').select('*').order('created_at', { ascending: false }),
        supabase.from('property_payments').select('*').order('received_on', { ascending: false }),
        supabase.from('property_checkouts').select('*').order('created_at', { ascending: false }),
        supabase.from('jewelry_inventory').select('*').order('created_at', { ascending: false }),
        supabase.from('pickleball_courts').select('*').order('created_at', { ascending: false }),
        supabase.from('court_bookings').select('*').order('created_at', { ascending: false }),
        supabase.from('jewelry_sales').select('*').order('sold_at', { ascending: false }),
        supabase.from('jewelry_returns').select('sale_id'),
      ]);
      for (const [label, result] of [
        ['properties', propertyResult],
        ['property bookings', propertyBookingResult],
        ['property payments', propertyPaymentResult],
        ['property checkouts', propertyCheckoutResult],
        ['jewelry inventory', jewelryResult],
        ['pickleball courts', courtResult],
        ['court bookings', bookingResult],
        ['jewelry sales', saleResult],
        ['jewelry returns', returnResult],
      ] as const) {
        if (result.error) throw new Error(`Could not load ${label} from Supabase: ${result.error.message}`);
      }
      if (!propertyResult.data || !propertyBookingResult.data || !propertyPaymentResult.data ||
        !propertyCheckoutResult.data || !jewelryResult.data ||
        !courtResult.data || !bookingResult.data || !saleResult.data || !returnResult.data) {
        throw new Error('Supabase returned incomplete Operations data.');
      }

      const properties = await Promise.all(propertyResult.data.map(async (row) => {
        const photoPaths = row.photo_paths || [];
        return {
          id: row.id,
          name: row.name,
          address: row.address,
          monthlyRent: Number(row.monthly_rent),
          details: row.details || '',
          photoPaths,
          photos: await signedPhotoUrls('property-images', photoPaths),
        };
      }));
      const jewelry = await Promise.all(jewelryResult.data.map(async (row) => {
        const photoPaths = row.photo_paths || [];
        return {
          id: row.id,
          sku: row.sku,
          name: row.name,
          description: row.description || '',
          unitCost: Number(row.unit_cost),
          sellingPrice: Number(row.selling_price),
          quantity: row.quantity,
          photoPaths,
          photos: await signedPhotoUrls('jewelry-images', photoPaths),
        };
      }));
      const courts = courtResult.data.map((row) => ({ id: row.id, name: row.name, notes: row.notes || '' }));
      const propertyBookings = propertyBookingResult.data.map((row) => ({
        id: row.id,
        propertyId: row.property_id,
        startDate: row.start_date,
        endDate: row.end_date,
        customerName: row.customer_name,
        monthlyRent: Number(row.monthly_rent),
        depositAmount: Number(row.deposit_amount ?? Number(row.monthly_rent) * 2),
        processedBy: row.processed_by,
        status: row.status,
      }));
      const propertyPayments = propertyPaymentResult.data.map((row) => ({
        id: row.id,
        bookingId: row.property_booking_id,
        amount: Number(row.amount),
        rentAmount: Number(row.rent_amount),
        depositAmount: Number(row.deposit_amount),
        receivedOn: row.received_on,
        recordedBy: row.recorded_by,
        status: row.status,
      }));
      const propertyCheckouts = propertyCheckoutResult.data.map((row) => ({
        id: row.id,
        bookingId: row.property_booking_id,
        damageAmount: Number(row.damage_amount),
        depositRefund: row.deposit_refund_amount === null ? null : Number(row.deposit_refund_amount),
        inspectionNotes: row.inspection_notes || '',
        recordedBy: row.recorded_by,
        status: row.status,
      }));
      const bookings = bookingResult.data.map((row) => ({
        id: row.id,
        courtId: row.court_id,
        date: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        customerName: row.customer_name,
        amount: Number(row.amount),
        processedBy: row.processed_by,
        status: row.status,
      }));
      const sales = saleResult.data.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id || null,
        itemId: row.inventory_item_id,
        itemName: jewelry.find((item) => item.id === row.inventory_item_id)?.name || 'Jewelry item',
        quantity: row.quantity,
        unitPrice: Number(row.unit_price),
        customerName: row.customer_name,
        soldAt: row.sold_at,
        processedBy: row.processed_by,
        returned: returnResult.data.some((returned) => returned.sale_id === row.id),
      }));
      setData({ properties, propertyBookings, propertyPayments, propertyCheckouts, jewelry, courts, bookings, sales });
      setMessage('');
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Operations data from Supabase.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, [authUserId, refreshKey]);

  const availableFor = (courtId: string, date: string, startTime: string, endTime: string) =>
    !data.bookings.some((booking) =>
      booking.status === 'confirmed' &&
      booking.courtId === courtId &&
      booking.date === date &&
      startTime < booking.endTime &&
      endTime > booking.startTime
    );

  const cancelPropertyBooking = async (booking: PropertyBookingRecord) => {
    if (!isOwner) {
      setMessage('Only an owner can cancel a property booking.');
      return;
    }
    if (booking.status !== 'pending_payment' ||
      (booking.endDate && booking.endDate < TODAY)) return;
    if (data.propertyPayments.some((payment) =>
      payment.bookingId === booking.id && payment.status === 'pending_confirmation'
    )) {
      setMessage('Confirm or reject the pending payment before cancelling this reservation.');
      return;
    }
    if (!window.confirm(`Cancel the unpaid property reservation for ${booking.customerName} from ${booking.startDate} to ${booking.endDate || 'an open-ended stay'}?`)) return;
    try {
      const { data: updated, error } = await supabase!
        .from('property_bookings')
        .update({ status: 'cancelled' })
        .eq('id', booking.id)
        .eq('status', 'confirmed')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!updated) throw new Error('This booking was already cancelled or is no longer available to cancel. Refresh the list and try again.');
    } catch (error) {
      setMessage(`Could not cancel property booking: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    await refreshData();
  };

  const cancelCourtBooking = async (booking: BookingRecord) => {
    if (!isOwner) {
      setMessage('Only an owner can cancel a court booking.');
      return;
    }
    if (booking.status !== 'confirmed' || booking.date < TODAY) return;
    if (!window.confirm(`Cancel the court booking for ${booking.customerName} on ${booking.date}, ${booking.startTime}–${booking.endTime}?\n\nThis updates booking availability but does not remove any existing ledger transaction or record a refund.`)) return;
    try {
      const { data: updated, error } = await supabase!
        .from('court_bookings')
        .update({ status: 'cancelled' })
        .eq('id', booking.id)
        .eq('status', 'confirmed')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!updated) throw new Error('This booking was already cancelled or is no longer available to cancel. Refresh the list and try again.');
    } catch (error) {
      setMessage(`Could not cancel court booking: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    await refreshData();
  };

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
    (total, sale) => total + (sale.returned ? 0 : sale.unitPrice * sale.quantity),
    0
  );
  const selectedProperty = data.properties.find((property) => property.id === propertyBookingForm.propertyId);
  const previewItem = photoPreview
    ? data.jewelry.find((item) => item.id === photoPreview.itemId)
    : undefined;
  const previewPhoto = previewItem?.photos[photoPreview?.photoIndex || 0];
  const previewRevenue = previewItem
    ? data.sales
        .filter((sale) => sale.itemId === previewItem.id)
        .reduce((total, sale) => total + sale.unitPrice * sale.quantity, 0)
    : 0;
  const previewProperty = propertyPreview
    ? data.properties.find((property) => property.id === propertyPreview.propertyId)
    : undefined;
  const previewPropertyPhoto = previewProperty?.photos[propertyPreview?.photoIndex || 0];

  useEffect(() => {
    if (!photoPreview && !propertyPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPhotoPreview(null);
        setPropertyPreview(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [photoPreview, propertyPreview]);

  const propertyAvailableFor = (propertyId: string, startDate: string, endDate: string) =>
    !data.propertyBookings.some((booking) =>
      (booking.status === 'confirmed' || booking.status === 'pending_payment') &&
      booking.propertyId === propertyId &&
      startDate <= (booking.endDate || '9999-12-31') &&
      endDate >= booking.startDate
    );

  const availableProperties = data.properties.filter((property) =>
    !propertyBookingForm.startDate ||
    propertyAvailableFor(
      property.id,
      propertyBookingForm.startDate,
      propertyBookingForm.openEnded ? '9999-12-31' : propertyBookingForm.endDate
    )
  );

  const handlePhotos = async (files: FileList | null): Promise<string[]> => {
    if (!files?.length) return [];
    setPhotoError('');
    try {
      const photos = await Promise.all(Array.from(files).map(compressPhoto));
      return photos;
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Could not load the selected images.');
      return [];
    }
  };

  const addProperty = async () => {
    if (!isOwner) {
      setMessage('Only an owner can edit the property catalog.');
      return;
    }
    const rent = Number(propertyForm.rent);
    if (!propertyForm.name.trim() || !propertyForm.address.trim() || !propertyForm.rent.trim() ||
      !Number.isFinite(rent) || rent < 0) {
      setMessage('Enter a property name, address, and a valid non-negative monthly rent.');
      return;
    }
    try {
      const previous = data.properties.find((item) => item.id === editingCatalogId);
      const photoPaths = await saveCatalogPhotos(
        'property-images',
        authUserId,
        propertyForm.photos,
        previous?.photos,
        previous?.photoPaths
      );
      const property = {
        name: propertyForm.name.trim(),
        address: propertyForm.address.trim(),
        monthly_rent: rent,
        details: propertyForm.details.trim(),
        photo_paths: photoPaths,
      };
      const result = editingCatalogId
        ? await supabase!.from('properties').update(property).eq('id', editingCatalogId)
        : await supabase!.from('properties').insert({ ...property, created_by: authUserId });
      if (result.error) throw new Error(`Could not save property to Supabase: ${result.error.message}`);
      const removedPaths = (previous?.photoPaths || []).filter((path) => !photoPaths.includes(path));
      if (removedPaths.length) {
        const { error } = await supabase!.storage.from('property-images').remove(removedPaths);
        if (error) setMessage(`Property was saved, but removed photo files could not be cleaned up: ${error.message}`);
      }
      await refreshData();
      setPropertyForm({ name: '', address: '', rent: '', details: '', photos: [] });
      setEditingCatalogId(null);
      setActiveForm(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save property to Supabase.');
    }
  };

  const editProperty = (property: PropertyRecord) => {
    if (!isOwner) return;
    setPropertyForm({
      name: property.name,
      address: property.address,
      rent: String(property.monthlyRent),
      details: property.details,
      photos: [...property.photos],
    });
    setEditingCatalogId(property.id);
    setPhotoError('');
    setActiveForm('property');
  };

  const editJewelryItem = (item: JewelryItem) => {
    if (!isOwner) return;
    setJewelryForm({
      sku: item.sku,
      name: item.name,
      description: item.description,
      cost: String(item.unitCost),
      price: String(item.sellingPrice),
      quantity: String(item.quantity),
      photos: [...item.photos],
    });
    setEditingCatalogId(item.id);
    setPhotoError('');
    setActiveForm('jewelry');
  };

  const editCourt = (court: CourtRecord) => {
    if (!isOwner) return;
    setCourtForm({ name: court.name, notes: court.notes });
    setEditingCatalogId(court.id);
    setActiveForm('court');
  };

  const cancelCatalogEdit = () => {
    setEditingCatalogId(null);
    setPhotoError('');
    setActiveForm(null);
  };

  const saveJewelryItem = async () => {
    if (!isOwner) {
      setMessage('Only an owner can edit the jewelry catalog.');
      return;
    }
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
    if (data.jewelry.some((item) =>
      item.id !== editingCatalogId && item.sku.toLowerCase() === jewelryForm.sku.trim().toLowerCase()
    )) {
      setMessage('That jewelry SKU already exists. Enter a unique SKU.');
      return;
    }
    try {
      const previous = data.jewelry.find((item) => item.id === editingCatalogId);
      const photoPaths = await saveCatalogPhotos(
        'jewelry-images',
        authUserId,
        jewelryForm.photos,
        previous?.photos,
        previous?.photoPaths
      );
      const item = {
        sku: jewelryForm.sku.trim(),
        name: jewelryForm.name.trim(),
        description: jewelryForm.description.trim(),
        unit_cost: unitCost,
        selling_price: sellingPrice,
        quantity,
        photo_paths: photoPaths,
      };
      const result = editingCatalogId
        ? await supabase!.from('jewelry_inventory').update(item).eq('id', editingCatalogId)
        : await supabase!.from('jewelry_inventory').insert({ ...item, created_by: authUserId });
      if (result.error) throw new Error(`Could not save jewelry inventory to Supabase: ${result.error.message}`);
      const removedPaths = (previous?.photoPaths || []).filter((path) => !photoPaths.includes(path));
      if (removedPaths.length) {
        const { error } = await supabase!.storage.from('jewelry-images').remove(removedPaths);
        if (error) setMessage(`Jewelry was saved, but removed photo files could not be cleaned up: ${error.message}`);
      }
      await refreshData();
      setJewelryForm({ sku: '', name: '', description: '', cost: '', price: '', quantity: '1', photos: [] });
      setEditingCatalogId(null);
      setActiveForm(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save jewelry inventory to Supabase.');
    }
  };

  const saveCourt = async () => {
    if (!isOwner) {
      setMessage('Only an owner can edit the pickleball court catalog.');
      return;
    }
    if (!courtForm.name.trim()) {
      setMessage('Enter a name for the pickleball court.');
      return;
    }
    if (data.courts.some((court) =>
      court.id !== editingCatalogId && court.name.toLowerCase() === courtForm.name.trim().toLowerCase()
    )) {
      setMessage('A court with that name already exists.');
      return;
    }
    const court = { name: courtForm.name.trim(), notes: courtForm.notes.trim(), ...(editingCatalogId ? {} : { created_by: authUserId }) };
    try {
      const result = editingCatalogId
        ? await supabase!.from('pickleball_courts').update(court).eq('id', editingCatalogId)
        : await supabase!.from('pickleball_courts').insert(court);
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      setMessage(`Could not save court to Supabase: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    if (await refreshData()) {
      setCourtForm({ name: '', notes: '' });
      setEditingCatalogId(null);
      setActiveForm(null);
    }
  };

  const addPropertyBooking = async () => {
    const property = data.properties.find((item) => item.id === propertyBookingForm.propertyId);
    if (!property || !propertyBookingForm.startDate ||
      propertyBookingForm.startDate < TODAY ||
      (!propertyBookingForm.openEnded &&
        (!propertyBookingForm.endDate || propertyBookingForm.endDate < propertyBookingForm.startDate))) {
      setMessage('Select a property, a valid move-in date, and an end date for a fixed-term booking.');
      return;
    }
    if (!propertyAvailableFor(
      property.id,
      propertyBookingForm.startDate,
      propertyBookingForm.openEnded ? '9999-12-31' : propertyBookingForm.endDate
    )) {
      setMessage('This property already has a booking during those dates. Choose another property or date range.');
      return;
    }
    const customerName = propertyBookingForm.customerName.trim() || 'Walk-in Customer';
    const depositAmount = property.monthlyRent * 2;
    try {
      const { error } = await supabase!.from('property_bookings').insert({
        property_id: property.id,
        start_date: propertyBookingForm.startDate,
        end_date: propertyBookingForm.openEnded ? null : propertyBookingForm.endDate,
        customer_name: customerName,
        monthly_rent: property.monthlyRent,
        deposit_amount: depositAmount,
        status: 'pending_payment',
        processed_by: authUserId,
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      setMessage(`Could not save property booking to Supabase: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    if (!(await refreshData())) return;
    setPropertyBookingForm({ propertyId: '', startDate: TODAY, endDate: '', openEnded: true, customerName: '' });
    setActiveForm(null);
    setMessage('Property reserved as pending payment. Record the amount received; the owner must confirm it to activate the booking.');
  };

  const recordPropertyPayment = async (booking: PropertyBookingRecord) => {
    const amount = Number(paymentForm.amount);
    const rentAmount = Number(paymentForm.rentAmount);
    const depositAmount = Number(paymentForm.depositAmount);
    if (![amount, rentAmount, depositAmount].every(Number.isFinite) ||
      amount <= 0 || rentAmount < 0 || depositAmount < 0 ||
      cents(rentAmount + depositAmount) !== cents(amount)) {
      setMessage('Enter the amount received and allocate it exactly between rent and deposit.');
      return;
    }
    setSavingPropertyPaymentId(booking.id);
    try {
      let paymentId: string;
      try {
        const { data: recordedPaymentId, error } = await supabase!.rpc('record_property_payment', {
          p_booking_id: booking.id,
          p_amount: cents(amount),
          p_rent_amount: cents(rentAmount),
          p_deposit_amount: cents(depositAmount),
          p_received_on: TODAY,
        });
        if (error) throw new Error(error.message);
        if (!recordedPaymentId) throw new Error('Supabase did not return the recorded payment ID.');
        paymentId = recordedPaymentId;
      } catch (error) {
        setMessage(`Could not record property payment: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
        return;
      }

      if (isOwner) {
        try {
          const { error } = await supabase!.rpc('confirm_property_payment', { p_payment_id: paymentId });
          if (error) throw new Error(error.message);
        } catch (error) {
          setPaymentBookingId(null);
          setPaymentForm({ amount: '', rentAmount: '', depositAmount: '' });
          await refreshData();
          setMessage(`Payment was recorded but could not be confirmed; it remains pending owner confirmation. ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
          return;
        }
      }

      setPaymentBookingId(null);
      setPaymentForm({ amount: '', rentAmount: '', depositAmount: '' });
      await refreshData();
      setMessage(isOwner
        ? 'Payment recorded and confirmed. Rent income was recorded and the booking is active.'
        : 'Payment recorded and waiting for owner confirmation. Rent and deposit balances update after confirmation.');
    } finally {
      setSavingPropertyPaymentId(null);
    }
  };

  const decidePropertyPayment = async (payment: PropertyPaymentRecord, decision: 'confirm' | 'reject') => {
    if (!isOwner) {
      setMessage('Only an owner can confirm or reject a property payment.');
      return;
    }
    try {
      const { error } = await supabase!.rpc(
        decision === 'confirm' ? 'confirm_property_payment' : 'reject_property_payment',
        { p_payment_id: payment.id }
      );
      if (error) throw new Error(error.message);
    } catch (error) {
      setMessage(`Could not ${decision} property payment: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    await refreshData();
    setMessage(decision === 'confirm'
      ? 'Payment confirmed. Rent income was recorded and the booking is active.'
      : 'Payment rejected. It was excluded from the rent and deposit balances.');
  };

  const requestPropertyCheckout = async (booking: PropertyBookingRecord) => {
    const damageAmount = Number(checkoutForm.damageAmount);
    const balance = propertyRentBalance(booking, data.propertyPayments);
    if (!Number.isFinite(damageAmount) || damageAmount < 0 || damageAmount > balance.depositPaid) {
      setMessage(`Damage deductions must be between zero and the confirmed deposit (${money(balance.depositPaid)}).`);
      return;
    }
    try {
      const { error } = await supabase!.rpc('request_property_checkout', {
        p_booking_id: booking.id,
        p_damage_amount: cents(damageAmount),
        p_inspection_notes: checkoutForm.inspectionNotes.trim(),
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      setMessage(`Could not submit checkout inspection: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    setCheckoutBookingId(null);
    setCheckoutForm({ damageAmount: '0', inspectionNotes: '' });
    await refreshData();
    setMessage('Checkout inspection submitted. The owner must approve the damage charge and deposit refund.');
  };

  const decidePropertyCheckout = async (checkout: PropertyCheckoutRecord, decision: 'approve' | 'reject') => {
    if (!isOwner) {
      setMessage('Only an owner can approve or reject property checkout.');
      return;
    }
    try {
      const { error } = await supabase!.rpc(
        decision === 'approve' ? 'approve_property_checkout' : 'reject_property_checkout',
        { p_checkout_id: checkout.id }
      );
      if (error) throw new Error(error.message);
    } catch (error) {
      setMessage(`Could not ${decision} property checkout: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    await refreshData();
    setMessage(decision === 'approve'
      ? 'Checkout approved. Damage deductions were recorded as revenue and the remaining deposit refund was recorded.'
      : 'Checkout inspection rejected. The booking remains active.');
  };

  const addBooking = async () => {
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
    const customerName = bookingForm.customerName.trim() || 'Walk-in Customer';
    try {
      const { error } = await supabase!.from('court_bookings').insert({
        court_id: court.id,
        booking_date: bookingForm.date,
        start_time: bookingForm.startTime,
        end_time: bookingForm.endTime,
        customer_name: customerName,
        amount: bookingAmount,
        processed_by: authUserId,
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      setMessage(`Could not save court booking to Supabase: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      return;
    }
    const ledgerSaved = await onCourtBooking(court.name, bookingForm.date, bookingAmount, customerName);
    if (!(await refreshData())) return;
    setBookingForm({ courtId: '', date: TODAY, startTime: '', endTime: '', customerName: '', amount: '0' });
    setActiveForm(null);
    if (!ledgerSaved && bookingAmount > 0) setMessage('Court booking was saved to Supabase, but its revenue entry could not be saved. Check the ledger error and retry.');
  };

  const processSale = async () => {
    if (!selectedSaleItem || !Number.isInteger(saleQuantity) || saleQuantity < 1 ||
      saleQuantity > selectedSaleItem.quantity) {
      setMessage('Select an in-stock jewelry item and enter a valid quantity not exceeding available stock.');
      return;
    }
    const customerName = saleForm.customerName.trim() || 'Walk-in Customer';
    try {
      const transactionId = await onJewelrySale(
        selectedSaleItem.id,
        saleQuantity,
        customerName
      );
      if (!transactionId) {
        await refreshData();
        setMessage('The jewelry sale request was not saved. No sale was completed and stock was not changed.');
        return;
      }
    } catch (error) {
      setMessage(`Could not submit jewelry sale for owner approval: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
      await refreshData();
      return;
    }
    if (!(await refreshData())) return;
    setSaleForm({ itemId: '', quantity: '1', customerName: '' });
    setActiveForm(null);
    setMessage('Jewelry sale request sent to the owner. The sale will be completed and stock deducted after approval.');
  };

  const returnJewelrySale = async (sale: JewelrySaleRecord) => {
    if (!isOwner) {
      setMessage('Only an owner can process a jewelry return or refund.');
      return;
    }
    if (sale.returned || !isJewelrySaleReturnEligible(sale.soldAt)) {
      setMessage('This sale is no longer eligible for a return or refund. Returns must be completed within 7 days of purchase.');
      return;
    }
    if (!window.confirm(`Return all ${sale.quantity} item(s) from ${sale.itemName} for ${money(sale.unitPrice * sale.quantity)}?\n\nThis records a refund expense and returns the items to inventory. Complete the actual payment to the customer separately.`)) return;

    setReturningSaleId(sale.id);
    setDismissedReturnActionIds((currentIds) => new Set(currentIds).add(sale.id));
    try {
      const { error } = await supabase!.rpc('return_jewelry_sale', { p_sale_id: sale.id });
      if (error) throw new Error(error.message);
      await refreshData();
      onJewelryReturn();
    } catch (error) {
      setMessage(`Could not process jewelry return: ${error instanceof Error ? error.message : 'Supabase could not be reached.'}`);
    } finally {
      setReturningSaleId(null);
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  const labelClass = 'mb-1 block text-xs font-semibold text-slate-600';
  const canEditCatalog = isOwner;

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Loading Operations data from Supabase...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Business Operations</h2>
        <p className="mt-1 text-xs text-slate-500">
          Properties, court availability, jewelry stock, bookings, and sales.
          {isOwner
            ? ' Owners can add or edit catalog records.'
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
            {canEditCatalog && <button onClick={() => {
              setPropertyForm({ name: '', address: '', rent: '', details: '', photos: [] });
              setEditingCatalogId(null);
              setPhotoError('');
              setActiveForm(activeForm === 'property' && !editingCatalogId ? null : 'property');
            }} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"><PlusCircle className="h-4 w-4" /> Add property</button>}
          </div>
          {activeForm === 'property' && canEditCatalog && (
            <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <label><span className={labelClass}>Property name</span><input className={inputClass} value={propertyForm.name} onChange={(e) => setPropertyForm({ ...propertyForm, name: e.target.value })} /></label>
              <label><span className={labelClass}>Monthly rent (PHP)</span><input type="number" min="0" className={inputClass} value={propertyForm.rent} onChange={(e) => setPropertyForm({ ...propertyForm, rent: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Street address</span><input className={inputClass} value={propertyForm.address} onChange={(e) => setPropertyForm({ ...propertyForm, address: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Notes (optional)</span><input className={inputClass} value={propertyForm.details} onChange={(e) => setPropertyForm({ ...propertyForm, details: e.target.value })} /></label>
              <div className="sm:col-span-2">
                <label className={labelClass}>Property photos (multiple images allowed)</label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  <Camera className="h-4 w-4" /> Choose images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void handlePhotos(e.target.files).then((photos) => {
                        if (photos.length) setPropertyForm((form) => ({ ...form, photos: [...form.photos, ...photos] }));
                      });
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                {photoError && <p role="alert" className="mt-2 text-xs text-rose-700">{photoError}</p>}
                {propertyForm.photos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {propertyForm.photos.map((photo, index) => (
                      <div key={`${index}-${photo.slice(0, 24)}`} className="relative">
                        <img src={photo} alt={`Property upload ${index + 1}`} className="h-16 w-16 rounded-lg object-cover" />
                        <button
                          type="button"
                          aria-label={`Remove property photo ${index + 1}`}
                          onClick={() => setPropertyForm((form) => ({
                            ...form,
                            photos: form.photos.filter((_, photoIndex) => photoIndex !== index),
                          }))}
                          className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-0.5 text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 sm:col-span-2"><button onClick={addProperty} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">{editingCatalogId ? 'Save changes' : 'Save property'}</button><button onClick={cancelCatalogEdit} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
            </div>
          )}
          {data.properties.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {data.properties.map((property) => (
                <article key={property.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
                  {(() => {
                    const bookingStatus = propertyBookingStatus(data.propertyBookings, property.id);
                    return (
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            bookingStatus.isBooked ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {bookingStatus.label}
                          </span>
                          <p className="mt-1 text-[11px] text-slate-600">{bookingStatus.detail}</p>
                        </div>
                      </div>
                    );
                  })()}
                  {property.photos.length > 0 && (
                    <div className="mb-3 flex min-w-0 gap-2 overflow-x-auto pb-1">
                      {property.photos.map((photo, index) => (
                        <div key={index} className={`group relative h-36 overflow-hidden rounded-lg bg-slate-100 ${property.photos.length === 1 ? 'w-full shrink-0' : 'w-36 shrink-0'}`}>
                          <img
                            src={photo}
                            alt={`${property.name} ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setPropertyPreview({ propertyId: property.id, photoIndex: index })}
                            aria-label={`View ${property.name} details, photo ${index + 1}`}
                            className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                          >
                            <span className="rounded-full bg-slate-950/70 p-3">
                              <Eye className="h-6 w-6" />
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-slate-900">{property.name}</h4>
                    {canEditCatalog && <button type="button" onClick={() => editProperty(property)} aria-label={`Edit ${property.name}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                  </div>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{property.address}</p>
                  <p className="mt-3 text-sm font-bold text-indigo-700">{money(property.monthlyRent)} <span className="text-xs font-normal text-slate-500">/ month</span></p>
                  <p className="mt-1 text-xs font-semibold text-slate-700">2-month deposit: <span className="text-indigo-700">{money(property.monthlyRent * 2)}</span></p>
                  {property.details && <p className="mt-1 text-xs text-slate-500">{property.details}</p>}
                  {data.propertyBookings
                    .filter((booking) =>
                      booking.propertyId === property.id &&
                      (booking.status === 'pending_payment' || booking.status === 'confirmed') &&
                      booking.startDate <= TODAY &&
                      (!booking.endDate || booking.endDate >= TODAY)
                    )
                    .slice(0, 1)
                    .map((booking) => {
                      const balance = propertyRentBalance(booking, data.propertyPayments);
                      return (
                        <div key={booking.id} className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                          <p className="font-semibold text-slate-800">{booking.customerName} · {booking.status === 'pending_payment' ? 'Awaiting first payment confirmation' : 'Current tenant'}</p>
                          <p className="mt-1 text-slate-600">Rent balance: <strong>{money(Math.max(0, balance.rentBalance))}</strong> · Deposit balance: {money(balance.depositBalance)}</p>
                          {balance.overdueBalance > 0
                            ? <p className="mt-1 font-semibold text-rose-700">Owner reminder: collect {money(balance.overdueBalance)} overdue for {balance.daysOverdue} day(s).</p>
                            : balance.rentAdvance > 0
                              ? <p className="mt-1 font-semibold text-emerald-700">Advance rent: {money(balance.rentAdvance)}{balance.daysUntilNextRent !== null ? ` · next rent due in ${balance.daysUntilNextRent} day(s)` : ''}.</p>
                              : balance.firstUnpaid
                                ? <p className="mt-1 font-semibold text-amber-700">{balance.firstUnpaid.dueDate === TODAY ? 'Rent due today.' : `Rent due ${balance.firstUnpaid.dueDate}.`}</p>
                                : balance.daysUntilNextRent !== null
                                  ? <p className="mt-1 text-slate-600">Next rent reminder in {balance.daysUntilNextRent} day(s) ({balance.nextRentDueDate}).</p>
                                  : null}
                        </div>
                      );
                    })}
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
                  <label className="flex items-center gap-2 self-end rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><input type="checkbox" checked={propertyBookingForm.openEnded} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, openEnded: e.target.checked })} /><span>Open-ended stay</span></label>
                  {!propertyBookingForm.openEnded && <label><span className={labelClass}>Planned lease end date</span><input type="date" min={propertyBookingForm.startDate} className={inputClass} value={propertyBookingForm.endDate} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, endDate: e.target.value })} /></label>}
                  <label><span className={labelClass}>Available property</span><select className={inputClass} value={propertyBookingForm.propertyId} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, propertyId: e.target.value })}><option value="">Select a property</option>{availableProperties.map((property) => <option key={property.id} value={property.id}>{property.name} — {money(property.monthlyRent)}/month</option>)}</select></label>
                  <label><span className={labelClass}>Customer / tenant name</span><input className={inputClass} value={propertyBookingForm.customerName} onChange={(e) => setPropertyBookingForm({ ...propertyBookingForm, customerName: e.target.value })} /></label>
                  <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
                    <span className="text-xs text-slate-600">
                      Monthly rent: <strong>{money(selectedProperty?.monthlyRent || 0)}</strong>
                      <span className="ml-3">Refundable 2-month deposit: <strong className="text-indigo-700">{money((selectedProperty?.monthlyRent || 0) * 2)}</strong></span>
                      <span className="ml-3">Rent is prorated for the move-in month</span>
                    </span>
                    <div className="flex gap-2"><button onClick={addPropertyBooking} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">Save property booking</button><button onClick={() => setActiveForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
                  </div>
                </div>
              )}
              {data.propertyBookings.length > 0 && (
                <div className="mt-3 divide-y divide-slate-100">
                  {data.propertyBookings.map((booking) => (
                    <div key={booking.id} className="space-y-2 py-3 text-xs">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                        <span className="font-semibold text-slate-800">
                          {data.properties.find((property) => property.id === booking.propertyId)?.name || 'Property'} • {booking.startDate} to {booking.endDate || 'Open-ended'}
                        </span>
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          booking.status === 'cancelled' || booking.status === 'checked_out' ? 'bg-slate-100 text-slate-600'
                            : booking.status === 'pending_payment' ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {booking.status === 'pending_payment' ? 'Pending payment'
                            : booking.status === 'checked_out' ? 'Checked out'
                              : booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                        </span>
                        <p className="mt-1 text-slate-500">{booking.customerName} • {money(booking.monthlyRent)}/month • 2-month deposit: {money(booking.depositAmount)} • {booking.processedBy}</p>
                        {(() => {
                          const balance = propertyRentBalance(booking, data.propertyPayments);
                          return (
                            <p className="mt-1 text-slate-600">
                              Rent paid {money(balance.rentPaid)} · Rent balance {money(Math.max(0, balance.rentBalance))} · Deposit paid {money(balance.depositPaid)} / {money(booking.depositAmount)} (balance {money(balance.depositBalance)})
                              {balance.rentAdvance > 0 && <span className="ml-1 font-semibold text-emerald-700">· Advance rent {money(balance.rentAdvance)}</span>}
                              {balance.overdueBalance > 0 && <span className="ml-1 font-semibold text-rose-700">· Overdue {money(balance.overdueBalance)} ({balance.daysOverdue} days)</span>}
                              {balance.firstUnpaid && !balance.daysOverdue && <span className="ml-1 font-semibold text-amber-700">· Rent due {balance.firstUnpaid.dueDate}</span>}
                            </p>
                          );
                        })()}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(booking.status === 'pending_payment' || booking.status === 'confirmed') && (
                            <button type="button" onClick={() => {
                              setPaymentBookingId(paymentBookingId === booking.id ? null : booking.id);
                              setPaymentForm({ amount: '', rentAmount: '', depositAmount: '' });
                            }} className="rounded-md border border-indigo-200 px-2.5 py-1.5 font-semibold text-indigo-700 hover:bg-indigo-50">Record payment</button>
                          )}
                          {isOwner && booking.status === 'pending_payment' && (
                            <button type="button" onClick={() => { void cancelPropertyBooking(booking); }} className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2.5 py-1.5 font-semibold text-rose-700 hover:bg-rose-50">
                              <Ban className="h-3.5 w-3.5" /> Cancel booking
                            </button>
                          )}
                          {booking.status === 'confirmed' && !data.propertyCheckouts.some((checkout) => checkout.bookingId === booking.id && checkout.status === 'pending_owner_approval') && (
                            <button type="button" onClick={() => {
                              setCheckoutBookingId(checkoutBookingId === booking.id ? null : booking.id);
                              setCheckoutForm({ damageAmount: '0', inspectionNotes: '' });
                            }} className="rounded-md border border-amber-200 px-2.5 py-1.5 font-semibold text-amber-800 hover:bg-amber-50">Check out & inspect</button>
                          )}
                        </div>
                      </div>

                      {paymentBookingId === booking.id && (
                        <div className="grid gap-2 rounded-lg bg-indigo-50 p-3 sm:grid-cols-4">
                          <label><span className={labelClass}>Total received</span><input type="number" min="0.01" step="0.01" className={inputClass} value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></label>
                          <label><span className={labelClass}>Allocate to rent</span><input type="number" min="0" step="0.01" className={inputClass} value={paymentForm.rentAmount} onChange={(e) => setPaymentForm({ ...paymentForm, rentAmount: e.target.value })} /></label>
                          <label><span className={labelClass}>Allocate to deposit</span><input type="number" min="0" step="0.01" className={inputClass} value={paymentForm.depositAmount} onChange={(e) => setPaymentForm({ ...paymentForm, depositAmount: e.target.value })} /></label>
                          <div className="flex items-end gap-2"><button type="button" disabled={savingPropertyPaymentId === booking.id} onClick={() => { void recordPropertyPayment(booking); }} className="rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:cursor-wait disabled:opacity-60">{savingPropertyPaymentId === booking.id ? 'Saving payment...' : isOwner ? 'Record & confirm payment' : 'Submit for owner confirmation'}</button><button type="button" disabled={savingPropertyPaymentId === booking.id} onClick={() => setPaymentBookingId(null)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-60">Close</button></div>
                          <p className="text-slate-600 sm:col-span-4">Split the receipt manually. Deposit collections are held separately and are not rent income.</p>
                        </div>
                      )}

                      {checkoutBookingId === booking.id && (
                        <div className="grid gap-2 rounded-lg bg-amber-50 p-3 sm:grid-cols-3">
                          <label><span className={labelClass}>Damage deduction from deposit</span><input type="number" min="0" max={propertyRentBalance(booking, data.propertyPayments).depositPaid} step="0.01" className={inputClass} value={checkoutForm.damageAmount} onChange={(e) => setCheckoutForm({ ...checkoutForm, damageAmount: e.target.value })} /></label>
                          <label className="sm:col-span-2"><span className={labelClass}>Inspection notes</span><input className={inputClass} value={checkoutForm.inspectionNotes} onChange={(e) => setCheckoutForm({ ...checkoutForm, inspectionNotes: e.target.value })} /></label>
                          <p className="text-slate-600 sm:col-span-2">Refund due after inspection: <strong>{money(Math.max(0, propertyRentBalance(booking, data.propertyPayments).depositPaid - (Number(checkoutForm.damageAmount) || 0)))}</strong>. Any rent balance remains separate.</p>
                          <button type="button" onClick={() => { void requestPropertyCheckout(booking); }} className="rounded-lg bg-amber-700 px-3 py-2 font-semibold text-white">Submit inspection to owner</button>
                        </div>
                      )}

                      {data.propertyPayments.filter((payment) => payment.bookingId === booking.id).map((payment) => (
                        <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                          <span>{payment.receivedOn} · Received {money(payment.amount)} (rent {money(payment.rentAmount)}, deposit {money(payment.depositAmount)}) · {payment.status.replace('_', ' ')}</span>
                          {isOwner && payment.status === 'pending_confirmation' && <span className="flex gap-2">
                            <button type="button" onClick={() => { void decidePropertyPayment(payment, 'confirm'); }} className="font-semibold text-emerald-700">Confirm</button>
                            <button type="button" onClick={() => { void decidePropertyPayment(payment, 'reject'); }} className="font-semibold text-rose-700">Reject</button>
                          </span>}
                        </div>
                      ))}

                      {data.propertyCheckouts.filter((checkout) => checkout.bookingId === booking.id).map((checkout) => (
                        <div key={checkout.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                          <span>Checkout inspection · Damage {money(checkout.damageAmount)} · {checkout.inspectionNotes || 'No notes'} · {checkout.status.replace(/_/g, ' ')}</span>
                          {isOwner && checkout.status === 'pending_owner_approval' && <span className="flex gap-2">
                            <button type="button" onClick={() => { void decidePropertyCheckout(checkout, 'approve'); }} className="font-semibold text-emerald-700">Approve checkout & record refund</button>
                            <button type="button" onClick={() => { void decidePropertyCheckout(checkout, 'reject'); }} className="font-semibold text-rose-700">Reject</button>
                          </span>}
                          {checkout.status === 'approved' && checkout.depositRefund !== null && <span>Refund recorded: {money(checkout.depositRefund)}</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
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
            {canEditCatalog && <button onClick={() => {
              setCourtForm({ name: '', notes: '' });
              setEditingCatalogId(null);
              setActiveForm(activeForm === 'court' && !editingCatalogId ? null : 'court');
            }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"><PlusCircle className="h-4 w-4" /> Add court</button>}
          </div>
          {activeForm === 'court' && canEditCatalog && (
            <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <label><span className={labelClass}>Court name or number</span><input className={inputClass} value={courtForm.name} onChange={(e) => setCourtForm({ ...courtForm, name: e.target.value })} placeholder="Court 5" /></label>
              <label><span className={labelClass}>Notes (optional)</span><input className={inputClass} value={courtForm.notes} onChange={(e) => setCourtForm({ ...courtForm, notes: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-2"><button onClick={saveCourt} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white">{editingCatalogId ? 'Save changes' : 'Save court'}</button><button onClick={cancelCatalogEdit} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.courts.map((court) => {
              const isAvailable = !bookingForm.startTime || !bookingForm.endTime ||
                availableFor(court.id, bookingForm.date, bookingForm.startTime, bookingForm.endTime);
              return <article key={court.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-slate-900">{court.name}</h4>
                    {canEditCatalog && <button type="button" onClick={() => editCourt(court)} aria-label={`Edit ${court.name}`} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Pencil className="h-3.5 w-3.5" /></button>}
                  </div>
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
              {data.bookings.length > 0 && (
                <div className="mt-3 divide-y divide-slate-100">
                  {data.bookings.map((booking) => (
                    <div key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                      <div>
                        <span className="font-semibold text-slate-800">
                          {data.courts.find((court) => court.id === booking.courtId)?.name || 'Court'} • {booking.date} • {booking.startTime}–{booking.endTime}
                        </span>
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          booking.status === 'cancelled' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {booking.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}
                        </span>
                        <p className="mt-1 text-slate-500">{booking.customerName} • {money(booking.amount)} • {booking.processedBy}</p>
                      </div>
                      {isOwner && booking.status === 'confirmed' && booking.date >= TODAY && (
                        <button
                          type="button"
                          onClick={() => { void cancelCourtBooking(booking); }}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2.5 py-1.5 font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          <Ban className="h-3.5 w-3.5" /> Cancel booking
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
            {canEditCatalog && <button onClick={() => {
              setJewelryForm({ sku: '', name: '', description: '', cost: '', price: '', quantity: '1', photos: [] });
              setEditingCatalogId(null);
              setPhotoError('');
              setActiveForm(activeForm === 'jewelry' && !editingCatalogId ? null : 'jewelry');
            }} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white"><PlusCircle className="h-4 w-4" /> Add jewelry</button>}
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
              <p className="text-xs font-semibold text-emerald-700">NET RECORDED SALES REVENUE</p>
              <p className="mt-1 text-lg font-bold text-emerald-800">{money(jewelrySalesRevenue)}</p>
              <p className="mt-1 text-[11px] text-emerald-700">Completed sales less full returns/refunds</p>
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
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><Camera className="h-4 w-4" /> Choose images<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void handlePhotos(e.target.files).then((photos) => { if (photos.length) setJewelryForm((form) => ({ ...form, photos: [...form.photos, ...photos] })); }); e.currentTarget.value = ''; }} /></label>
                {photoError && <p role="alert" className="mt-2 text-xs text-rose-700">{photoError}</p>}
                {jewelryForm.photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{jewelryForm.photos.map((photo, index) => <div key={`${index}-${photo.slice(0, 24)}`} className="relative"><img src={photo} alt={`Jewelry upload ${index + 1}`} className="h-16 w-16 rounded-lg object-cover" /><button aria-label={`Remove photo ${index + 1}`} onClick={() => setJewelryForm({ ...jewelryForm, photos: jewelryForm.photos.filter((_, photoIndex) => photoIndex !== index) })} className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-0.5 text-white"><X className="h-3 w-3" /></button></div>)}</div>}
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button onClick={saveJewelryItem} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white">{editingCatalogId ? 'Save changes' : 'Save inventory item'}</button><button onClick={cancelCatalogEdit} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Cancel</button></div>
            </div>
          )}
          {canViewJewelry && data.jewelry.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.jewelry.map((item) => (
                <article key={item.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
                  {item.photos.length > 0 && (
                    <div className="flex min-w-0 gap-1 overflow-x-auto bg-slate-100 p-1">
                      {item.photos.map((photo, index) => (
                        <div key={index} className={`group relative h-40 ${item.photos.length === 1 ? 'w-full shrink-0' : 'w-48 shrink-0'}`}>
                          <img src={photo} alt={`${item.name} ${index + 1}`} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setPhotoPreview({ itemId: item.id, photoIndex: index })}
                            aria-label={`View ${item.name} details, photo ${index + 1}`}
                            className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                          >
                            <span className="rounded-full bg-slate-950/70 p-3">
                              <Eye className="h-6 w-6" />
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2"><div><h4 className="font-semibold text-slate-900">{item.name}</h4><p className="text-[11px] text-slate-500">SKU {item.sku}</p></div><div className="flex items-center gap-2">{canEditCatalog && <button type="button" onClick={() => editJewelryItem(item)} aria-label={`Edit ${item.name}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3 w-3" /> Edit</button>}<span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">{item.quantity} in stock</span></div></div>
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
              {data.sales.length > 0 && (
                <div className="mt-3 divide-y divide-slate-100">
                  {data.sales.map((sale) => {
                    const eligible = !sale.returned && isJewelrySaleReturnEligible(sale.soldAt);
                    const returnActionDismissed = dismissedReturnActionIds.has(sale.id);
                    return (
                      <div key={sale.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
                        <div>
                          <span className="font-semibold text-slate-800">
                            {sale.itemName} × {sale.quantity} • {money(sale.unitPrice * sale.quantity)}
                          </span>
                          {sale.returned && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Returned / refunded</span>}
                          {!sale.returned && returnActionDismissed && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Return action dismissed</span>}
                          {!sale.returned && !eligible && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Return window expired</span>}
                          {isOwner && !sale.returned && eligible && !returnActionDismissed && (
                            <p className="mt-1 text-[10px] text-slate-500">Return/refund by {jewelryReturnDeadline(sale.soldAt)} · full sale only</p>
                          )}
                          <p className="mt-1 text-slate-500">{sale.customerName} • {new Date(sale.soldAt).toLocaleString()} • {sale.processedBy}</p>
                        </div>
                        {isOwner && !sale.returned && eligible && !returnActionDismissed && (
                          <button
                            type="button"
                            onClick={() => { void returnJewelrySale(sale); }}
                            disabled={returningSaleId === sale.id}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1.5 font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {returningSaleId === sale.id ? 'Processing…' : 'Return / Refund'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {previewItem && previewPhoto && photoPreview && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPhotoPreview(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="jewelry-preview-title"
            className="my-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="jewelry-preview-title" className="text-lg font-bold text-slate-900">{previewItem.name}</h2>
                <p className="text-xs text-slate-500">SKU {previewItem.sku} · Photo {photoPreview.photoIndex + 1} of {previewItem.photos.length}</p>
              </div>
              <button
                type="button"
                onClick={() => setPhotoPreview(null)}
                aria-label="Close jewelry details"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid md:grid-cols-[minmax(0,1.6fr)_minmax(250px,1fr)]">
              <div className="relative flex min-h-64 items-center justify-center bg-slate-950 p-4">
                <img
                  src={previewPhoto}
                  alt={`${previewItem.name} enlarged`}
                  className="max-h-[65vh] max-w-full object-contain"
                />
                {previewItem.photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous jewelry photo"
                      onClick={() => setPhotoPreview({
                        itemId: previewItem.id,
                        photoIndex: (photoPreview.photoIndex - 1 + previewItem.photos.length) % previewItem.photos.length,
                      })}
                      className="absolute left-3 rounded-full bg-white/90 p-2 text-slate-900 shadow hover:bg-white"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next jewelry photo"
                      onClick={() => setPhotoPreview({
                        itemId: previewItem.id,
                        photoIndex: (photoPreview.photoIndex + 1) % previewItem.photos.length,
                      })}
                      className="absolute right-3 rounded-full bg-white/90 p-2 text-slate-900 shadow hover:bg-white"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              <div className="space-y-5 p-5">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item details</h3>
                  <p className="mt-2 text-sm text-slate-700">{previewItem.description || 'No description provided.'}</p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-500">In stock</dt><dd className="mt-1 font-semibold text-slate-900">{previewItem.quantity}</dd></div>
                  <div><dt className="text-xs text-slate-500">Unit cost</dt><dd className="mt-1 font-semibold text-slate-900">{money(previewItem.unitCost)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Selling price</dt><dd className="mt-1 font-semibold text-slate-900">{money(previewItem.sellingPrice)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Stock cost total</dt><dd className="mt-1 font-semibold text-slate-900">{money(previewItem.unitCost * previewItem.quantity)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Stock selling value</dt><dd className="mt-1 font-semibold text-indigo-700">{money(previewItem.sellingPrice * previewItem.quantity)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Recorded sales revenue</dt><dd className="mt-1 font-semibold text-emerald-700">{money(previewRevenue)}</dd></div>
                </dl>
                {previewItem.photos.length > 1 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Photos</h3>
                    <div className="flex gap-2 overflow-x-auto">
                      {previewItem.photos.map((photo, index) => (
                        <button
                          key={index}
                          type="button"
                          aria-label={`Show photo ${index + 1}`}
                          aria-pressed={photoPreview.photoIndex === index}
                          onClick={() => setPhotoPreview({ itemId: previewItem.id, photoIndex: index })}
                          className={`shrink-0 overflow-hidden rounded-lg border-2 ${photoPreview.photoIndex === index ? 'border-indigo-600' : 'border-transparent'}`}
                        >
                          <img src={photo} alt="" className="h-14 w-14 object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </section>
        </div>
      )}
      {previewProperty && previewPropertyPhoto && propertyPreview && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPropertyPreview(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="property-preview-title"
            className="my-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="property-preview-title" className="text-lg font-bold text-slate-900">{previewProperty.name}</h2>
                <p className="text-xs text-slate-500">Photo {propertyPreview.photoIndex + 1} of {previewProperty.photos.length}</p>
              </div>
              <button
                type="button"
                onClick={() => setPropertyPreview(null)}
                aria-label="Close property details"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid md:grid-cols-[minmax(0,1.6fr)_minmax(250px,1fr)]">
              <div className="relative flex min-h-64 items-center justify-center bg-slate-950 p-4">
                <img
                  src={previewPropertyPhoto}
                  alt={`${previewProperty.name} enlarged`}
                  className="max-h-[65vh] max-w-full object-contain"
                />
                {previewProperty.photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous property photo"
                      onClick={() => setPropertyPreview({
                        propertyId: previewProperty.id,
                        photoIndex: (propertyPreview.photoIndex - 1 + previewProperty.photos.length) % previewProperty.photos.length,
                      })}
                      className="absolute left-3 rounded-full bg-white/90 p-2 text-slate-900 shadow hover:bg-white"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next property photo"
                      onClick={() => setPropertyPreview({
                        propertyId: previewProperty.id,
                        photoIndex: (propertyPreview.photoIndex + 1) % previewProperty.photos.length,
                      })}
                      className="absolute right-3 rounded-full bg-white/90 p-2 text-slate-900 shadow hover:bg-white"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              <div className="space-y-5 p-5">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property details</h3>
                  <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-700">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    {previewProperty.address}
                  </p>
                  {previewProperty.details && <p className="mt-3 text-sm text-slate-600">{previewProperty.details}</p>}
                </div>
                <div className="rounded-xl bg-indigo-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Monthly rent</p>
                  <p className="mt-1 text-xl font-bold text-indigo-800">{money(previewProperty.monthlyRent)}</p>
                </div>
                {previewProperty.photos.length > 1 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Photos</h3>
                    <div className="flex gap-2 overflow-x-auto">
                      {previewProperty.photos.map((photo, index) => (
                        <button
                          key={index}
                          type="button"
                          aria-label={`Show property photo ${index + 1}`}
                          aria-pressed={propertyPreview.photoIndex === index}
                          onClick={() => setPropertyPreview({ propertyId: previewProperty.id, photoIndex: index })}
                          className={`shrink-0 overflow-hidden rounded-lg border-2 ${propertyPreview.photoIndex === index ? 'border-indigo-600' : 'border-transparent'}`}
                        >
                          <img src={photo} alt="" className="h-14 w-14 object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
