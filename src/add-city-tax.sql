-- City tax: included in Booking.com gross but not revenue — deducted from booking payout
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS city_tax numeric(10,2) DEFAULT 0;
