import { supabase } from './supabaseClient';

interface LegacyProperty {
  id: string;
  name: string;
  address: string;
  monthlyRent: number;
  details?: string;
  photos?: string[];
}

interface LegacyJewelryItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  unitCost: number;
  sellingPrice: number;
  quantity: number;
  photos?: string[];
}

interface LegacyCourt {
  id: string;
  name: string;
  notes?: string;
}

interface LegacyPropertyBooking {
  id: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  customerName: string;
  monthlyRent: number;
  depositAmount?: number;
}

interface LegacyCourtBooking {
  id: string;
  courtId: string;
  date: string;
  startTime: string;
  endTime: string;
  customerName: string;
  amount: number;
}

interface LegacySale {
  id: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  customerName: string;
  soldAt: string;
}

interface LegacyOperations {
  properties?: LegacyProperty[];
  propertyBookings?: LegacyPropertyBooking[];
  jewelry?: LegacyJewelryItem[];
  courts?: LegacyCourt[];
  bookings?: LegacyCourtBooking[];
  sales?: LegacySale[];
}

interface LegacyTransaction {
  id: string;
  referenceNo: string;
  businessId: string;
  txType: string;
  category: string;
  counterpartyTin?: string;
  counterpartyName: string;
  description: string;
  amount: number;
  vatAmount: number;
  receiptFilename?: string;
  reconciled: boolean;
  status: string;
  gateReason?: string;
  submittedBy?: string;
  txDate: string;
  createdAt?: string;
}

interface LegacyLedger {
  transactions?: LegacyTransaction[];
}

interface MigrationMap {
  properties: Record<string, string>;
  jewelry: Record<string, string>;
  courts: Record<string, string>;
  propertyBookings: Record<string, string>;
  bookings: Record<string, string>;
  sales: Record<string, string>;
  transactions: Record<string, string>;
  complete: boolean;
}

export interface LegacyDataStatus {
  available: boolean;
  complete: boolean;
  error?: string;
}

export interface MigrationSummary {
  properties: number;
  jewelry: number;
  courts: number;
  propertyBookings: number;
  bookings: number;
  sales: number;
  transactions: number;
  auditHistoryNote: string;
}

const OPERATIONS_KEY = 'jast-operations-v1';
const LEDGER_KEY = 'jast-erp-ledger-v1';
const mapKey = (userId: string) => `jast-supabase-migration-v1-${userId}`;

const emptyMap = (): MigrationMap => ({
  properties: {},
  jewelry: {},
  courts: {},
  propertyBookings: {},
  bookings: {},
  sales: {},
  transactions: {},
  complete: false,
});

function readLocalJson<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error(`Saved browser data in ${key} is not valid.`);
  return parsed as T;
}

function readMigrationMap(userId: string): MigrationMap {
  const raw = window.localStorage.getItem(mapKey(userId));
  if (!raw) return emptyMap();
  const saved = JSON.parse(raw) as Partial<MigrationMap>;
  return {
    ...emptyMap(),
    ...saved,
    properties: saved.properties || {},
    jewelry: saved.jewelry || {},
    courts: saved.courts || {},
    propertyBookings: saved.propertyBookings || {},
    bookings: saved.bookings || {},
    sales: saved.sales || {},
    transactions: saved.transactions || {},
  };
}

function saveMigrationMap(userId: string, map: MigrationMap) {
  try {
    window.localStorage.setItem(mapKey(userId), JSON.stringify(map));
  } catch (error) {
    throw new Error(`Supabase import progress could not be saved in this browser: ${error instanceof Error ? error.message : 'storage is unavailable'}`);
  }
}

export function getLegacyDataStatus(userId: string): LegacyDataStatus {
  try {
    const operations = readLocalJson<LegacyOperations>(OPERATIONS_KEY);
    const ledger = readLocalJson<LegacyLedger>(LEDGER_KEY);
    const available = Boolean(
      operations?.properties?.length ||
      operations?.propertyBookings?.length ||
      operations?.jewelry?.length ||
      operations?.courts?.length ||
      operations?.bookings?.length ||
      operations?.sales?.length ||
      ledger?.transactions?.length
    );
    return { available, complete: readMigrationMap(userId).complete };
  } catch (error) {
    return {
      available: false,
      complete: false,
      error: `Could not read older browser data or import progress: ${error instanceof Error ? error.message : 'browser storage is unavailable'}`,
    };
  }
}

async function uploadLegacyPhotos(bucket: string, userId: string, recordId: string, photos: string[] = []) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const paths: string[] = [];
  for (const [index, photo] of photos.entries()) {
    if (!photo.startsWith('data:image/')) {
      throw new Error(`A legacy photo for record ${recordId} is not a local image and cannot be imported automatically.`);
    }
    const response = await fetch(photo);
    if (!response.ok) throw new Error(`Could not read a saved photo for record ${recordId}.`);
    const blob = await response.blob();
    const path = `${userId}/legacy/${recordId}/${index}.jpg`;
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });
    if (error) throw new Error(`Could not import a saved photo: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

async function getMappedId(
  table: 'properties' | 'jewelry_inventory' | 'pickleball_courts',
  id: string | undefined
): Promise<string | null> {
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not verify an imported ${table} record: ${error.message}`);
  return data?.id || null;
}

export async function migrateLegacyBrowserData(userId: string, userName: string): Promise<MigrationSummary> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const operations = readLocalJson<LegacyOperations>(OPERATIONS_KEY) || {};
  const ledger = readLocalJson<LegacyLedger>(LEDGER_KEY) || {};
  const map = readMigrationMap(userId);
  const summary: MigrationSummary = {
    properties: 0,
    jewelry: 0,
    courts: 0,
    propertyBookings: 0,
    bookings: 0,
    sales: 0,
    transactions: 0,
    auditHistoryNote: 'Supabase generated a new audit entry for each imported transaction; the old browser audit log cannot be inserted into the immutable audit table.',
  };

  const saleQuantitiesByItem = new Map<string, number>();
  for (const sale of operations.sales || []) {
    saleQuantitiesByItem.set(sale.itemId, (saleQuantitiesByItem.get(sale.itemId) || 0) + sale.quantity);
  }

  for (const [index, property] of (operations.properties || []).entries()) {
    const key = property.id || `property-${index}`;
    let remoteId = await getMappedId('properties', map.properties[key]);
    if (!remoteId) {
      const { data: existing, error: findError } = await supabase.from('properties')
        .select('id, photo_paths')
        .eq('name', property.name)
        .eq('address', property.address)
        .limit(1)
        .maybeSingle();
      if (findError) throw new Error(`Could not check for an existing property: ${findError.message}`);
      const photoPaths = existing?.photo_paths?.length
        ? existing.photo_paths
        : await uploadLegacyPhotos('property-images', userId, key, property.photos);
      if (existing) {
        remoteId = existing.id;
        if (!existing.photo_paths?.length && photoPaths.length) {
          const { error } = await supabase.from('properties').update({ photo_paths: photoPaths }).eq('id', remoteId);
          if (error) throw new Error(`Could not attach imported property photos: ${error.message}`);
        }
      } else {
        const { data, error } = await supabase.from('properties').insert({
          name: property.name,
          address: property.address,
          monthly_rent: property.monthlyRent,
          details: property.details || '',
          photo_paths: photoPaths,
          created_by: userId,
        }).select('id').single();
        if (error) throw new Error(`Could not import property ${property.name}: ${error.message}`);
        remoteId = data.id;
      }
      if (!remoteId) throw new Error(`Could not resolve the Supabase property for ${property.name}.`);
      map.properties[key] = remoteId;
      saveMigrationMap(userId, map);
    }
    summary.properties += 1;
  }

  for (const [index, item] of (operations.jewelry || []).entries()) {
    const key = item.id || `jewelry-${index}`;
    let remoteId = await getMappedId('jewelry_inventory', map.jewelry[key]);
    if (!remoteId) {
      const { data: existing, error: findError } = await supabase.from('jewelry_inventory')
        .select('id, name, unit_cost, selling_price, quantity, photo_paths')
        .eq('sku', item.sku)
        .maybeSingle();
      if (findError) throw new Error(`Could not check for jewelry SKU ${item.sku}: ${findError.message}`);
      if (existing) {
        const expectedQuantity = item.quantity + (saleQuantitiesByItem.get(item.id) || 0);
        if (existing.name !== item.name ||
          Number(existing.unit_cost) !== item.unitCost ||
          Number(existing.selling_price) !== item.sellingPrice ||
          existing.quantity !== expectedQuantity) {
          throw new Error(`Jewelry SKU ${item.sku} already exists in Supabase but is not linked to this browser record. Resolve that SKU before importing to avoid changing inventory or sales history.`);
        }
        remoteId = existing.id;
        if (!existing.photo_paths?.length && item.photos?.length) {
          const photoPaths = await uploadLegacyPhotos('jewelry-images', userId, key, item.photos);
          const { error } = await supabase.from('jewelry_inventory')
            .update({ photo_paths: photoPaths })
            .eq('id', remoteId);
          if (error) throw new Error(`Could not attach imported jewelry photos: ${error.message}`);
        }
      } else {
        const photoPaths = await uploadLegacyPhotos('jewelry-images', userId, key, item.photos);
        const { data, error } = await supabase.from('jewelry_inventory').insert({
          sku: item.sku,
          name: item.name,
          description: item.description || '',
          unit_cost: item.unitCost,
          selling_price: item.sellingPrice,
          quantity: item.quantity + (saleQuantitiesByItem.get(item.id) || 0),
          photo_paths: photoPaths,
          created_by: userId,
        }).select('id').single();
        if (error) throw new Error(`Could not import jewelry item ${item.name}: ${error.message}`);
        remoteId = data.id;
      }
    }
    if (!remoteId) throw new Error(`Could not resolve the Supabase jewelry item for ${item.name}.`);
    map.jewelry[key] = remoteId;
    saveMigrationMap(userId, map);
    summary.jewelry += 1;
  }

  for (const [index, court] of (operations.courts || []).entries()) {
    const key = court.id || `court-${index}`;
    let remoteId = await getMappedId('pickleball_courts', map.courts[key]);
    if (!remoteId) {
      const { data: existing, error: findError } = await supabase.from('pickleball_courts')
        .select('id')
        .eq('name', court.name)
        .maybeSingle();
      if (findError) throw new Error(`Could not check for court ${court.name}: ${findError.message}`);
      if (existing) {
        remoteId = existing.id;
      } else {
        const { data, error } = await supabase.from('pickleball_courts').insert({
          name: court.name,
          notes: court.notes || '',
          created_by: userId,
        }).select('id').single();
        if (error) throw new Error(`Could not import court ${court.name}: ${error.message}`);
        remoteId = data.id;
      }
      if (!remoteId) throw new Error(`Could not resolve the Supabase court for ${court.name}.`);
      map.courts[key] = remoteId;
      saveMigrationMap(userId, map);
    }
    summary.courts += 1;
  }

  for (const [index, booking] of (operations.propertyBookings || []).entries()) {
    const key = booking.id || `property-booking-${index}`;
    if (map.propertyBookings[key]) {
      summary.propertyBookings += 1;
      continue;
    }
    const propertyId = map.properties[booking.propertyId];
    if (!propertyId) throw new Error('A saved property booking refers to a property that was not imported.');
    const { data: existing, error: findError } = await supabase.from('property_bookings')
      .select('id')
      .eq('property_id', propertyId)
      .eq('start_date', booking.startDate)
      .eq('end_date', booking.endDate)
      .eq('customer_name', booking.customerName)
      .limit(1)
      .maybeSingle();
    if (findError) throw new Error(`Could not check for an existing property booking: ${findError.message}`);
    let remoteId = existing?.id;
    if (!remoteId) {
      const { data, error } = await supabase.from('property_bookings').insert({
        property_id: propertyId,
        start_date: booking.startDate,
        end_date: booking.endDate,
        customer_name: booking.customerName,
        monthly_rent: booking.monthlyRent,
        deposit_amount: booking.depositAmount ?? booking.monthlyRent * 2,
        status: 'confirmed',
        processed_by: userId,
      }).select('id').single();
      if (error) throw new Error(`Could not import a property booking: ${error.message}`);
      remoteId = data.id;
    }
    map.propertyBookings[key] = remoteId;
    saveMigrationMap(userId, map);
    summary.propertyBookings += 1;
  }

  for (const [index, booking] of (operations.bookings || []).entries()) {
    const key = booking.id || `court-booking-${index}`;
    if (map.bookings[key]) {
      summary.bookings += 1;
      continue;
    }
    const courtId = map.courts[booking.courtId];
    if (!courtId) throw new Error('A saved court booking refers to a court that was not imported.');
    const { data: existing, error: findError } = await supabase.from('court_bookings')
      .select('id')
      .eq('court_id', courtId)
      .eq('booking_date', booking.date)
      .eq('start_time', booking.startTime)
      .eq('end_time', booking.endTime)
      .eq('customer_name', booking.customerName)
      .limit(1)
      .maybeSingle();
    if (findError) throw new Error(`Could not check for an existing court booking: ${findError.message}`);
    let remoteId = existing?.id;
    if (!remoteId) {
      const { data, error } = await supabase.from('court_bookings').insert({
        court_id: courtId,
        booking_date: booking.date,
        start_time: booking.startTime,
        end_time: booking.endTime,
        customer_name: booking.customerName,
        amount: booking.amount,
        processed_by: userId,
      }).select('id').single();
      if (error) throw new Error(`Could not import a court booking: ${error.message}`);
      remoteId = data.id;
    }
    map.bookings[key] = remoteId;
    saveMigrationMap(userId, map);
    summary.bookings += 1;
  }

  for (const [index, sale] of (operations.sales || []).entries()) {
    const key = sale.id || `sale-${index}`;
    if (map.sales[key]) {
      summary.sales += 1;
      continue;
    }
    const itemId = map.jewelry[sale.itemId];
    if (!itemId) throw new Error('A saved jewelry sale refers to an item that was not imported.');
    const soldAt = sale.soldAt || new Date().toISOString();
    const { data: existing, error: findError } = await supabase.from('jewelry_sales')
      .select('id')
      .eq('inventory_item_id', itemId)
      .eq('quantity', sale.quantity)
      .eq('unit_price', sale.unitPrice)
      .eq('customer_name', sale.customerName)
      .eq('sold_at', soldAt)
      .limit(1)
      .maybeSingle();
    if (findError) throw new Error(`Could not check for an existing jewelry sale: ${findError.message}`);
    let remoteId = existing?.id;
    if (!remoteId) {
      const { data, error } = await supabase.from('jewelry_sales').insert({
        inventory_item_id: itemId,
        quantity: sale.quantity,
        unit_price: sale.unitPrice,
        customer_name: sale.customerName,
        processed_by: userId,
        sold_at: soldAt,
      }).select('id').single();
      if (error) throw new Error(`Could not import a jewelry sale: ${error.message}`);
      remoteId = data.id;
    }
    map.sales[key] = remoteId;
    saveMigrationMap(userId, map);
    summary.sales += 1;
  }

  for (const [index, transaction] of (ledger.transactions || []).entries()) {
    const key = transaction.id || `transaction-${index}`;
    if (map.transactions[key]) {
      summary.transactions += 1;
      continue;
    }
    if (!transaction.referenceNo) throw new Error('A saved transaction has no reference number and cannot be safely deduplicated.');
    const { data: existing, error: findError } = await supabase.from('transactions')
      .select('id, status, amount, business_id, counterparty_name')
      .eq('reference_no', transaction.referenceNo)
      .maybeSingle();
    if (findError) throw new Error(`Could not check transaction ${transaction.referenceNo}: ${findError.message}`);
    if (existing && (
      Number(existing.amount) !== transaction.amount ||
      existing.business_id !== transaction.businessId ||
      existing.counterparty_name !== transaction.counterpartyName
    )) {
      throw new Error(`Transaction reference ${transaction.referenceNo} already exists in Supabase with different details.`);
    }
    let remoteId = existing?.id;
    let remoteStatus = existing?.status;
    if (!remoteId) {
      const { data, error } = await supabase.from('transactions').insert({
        reference_no: transaction.referenceNo,
        business_id: transaction.businessId,
        tx_type: transaction.txType,
        category: transaction.category,
        counterparty_tin: transaction.counterpartyTin || null,
        counterparty_name: transaction.counterpartyName,
        description: transaction.description,
        amount: transaction.amount,
        vat_amount: transaction.vatAmount,
        receipt_filename: transaction.receiptFilename || null,
        reconciled: transaction.reconciled,
        status: transaction.status,
        gate_reason: `Imported legacy transaction; originally submitted by ${transaction.submittedBy || 'unknown'}`,
        submitted_by: userId,
        submitted_by_name: userName,
        tx_date: transaction.txDate,
      }).select('id, status').single();
      if (error) throw new Error(`Could not import transaction ${transaction.referenceNo}: ${error.message}`);
      remoteId = data.id;
      remoteStatus = data.status;
    }
    if (remoteStatus !== transaction.status) {
      const { error: statusError } = await supabase.from('transactions').update({
        status: transaction.status,
        approved_by: transaction.status === 'APPROVED' ? userId : null,
        approved_at: transaction.createdAt || new Date().toISOString(),
      }).eq('id', remoteId);
      if (statusError) throw new Error(`Transaction ${transaction.referenceNo} was imported but its original status could not be restored: ${statusError.message}`);
    }
    map.transactions[key] = remoteId;
    saveMigrationMap(userId, map);
    summary.transactions += 1;
  }

  map.complete = true;
  saveMigrationMap(userId, map);
  return summary;
}
