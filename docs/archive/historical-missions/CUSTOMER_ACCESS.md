# 👥 Customer Access Provisioning

**Purpose**: Guide for inviting customers and granting them access to their site dashboard  
**Last Updated**: January 24, 2026

---

## 🎯 Overview

The customer invite flow allows site owners to transfer site ownership to customers, giving them access to their own dashboard and analytics.

**Flow**:
1. Owner creates site in dashboard
2. Owner invites customer via email
3. System creates/fetches customer user account
4. Site ownership transfers to customer (`sites.user_id` updated)
5. Customer receives magic link to log in
6. Customer can access dashboard for their site

---

## 🔧 How It Works

### API Endpoint

**POST** `/api/customers/invite`

**Request Body**:
```json
{
  "email": "customer@example.com",
  "site_id": "uuid-of-site"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Customer invited successfully. Site ownership transferred.",
  "customer_email": "customer@example.com",
  "site_name": "My Site",
  "login_url": "https://console.example.com/auth/confirm?token=...",
  "note": "Share this login URL with the customer"
}
```

### Security Flow

1. **Owner Authentication**: Current logged-in user must be authenticated
2. **Ownership Verification**: Site must belong to current owner (`sites.user_id = owner.id`)
3. **User Creation**: If customer email doesn't exist, create new Supabase auth user
4. **Ownership Transfer**: Update `sites.user_id` to customer's user_id
5. **Magic Link Generation**: Generate login link for customer

### Database Changes

**MINIMAL Approach** (Current Implementation):
- Updates `sites.user_id` to customer's user_id
- Original owner loses access (ownership transferred)
- Simple, no additional tables needed

**Note**: This is a single-owner model. For multi-user access, a `site_members` table would be needed (future enhancement).

---

## 📋 Step-by-Step Usage

### Step 1: Create Site

1. Log in to OPS Console dashboard
2. Navigate to **Sites** section
3. Click **"+ Add Site"**
4. Fill in site details and create

### Step 2: Invite Customer

1. Find the site in the **Sites** list
2. Scroll to **"Invite Customer"** section
3. Enter customer email address
4. Click **"📧 Invite"** button

### Step 3: Share Login URL

1. After successful invite, a login URL is generated
2. Copy the login URL from the success message
3. Share with customer via email or secure channel
4. Customer clicks link to log in and access dashboard

### Step 4: Customer Access

1. Customer clicks magic link
2. Redirected to dashboard
3. Can view their site's analytics, events, and calls
4. Can manage their site settings

---

## 🔒 Security Considerations

### Ownership Transfer

**Important**: Inviting a customer **transfers ownership** of the site. The original owner will lose access after the transfer.

**Before Inviting**:
- Ensure you want to transfer ownership
- Consider if you need to maintain access (may require multi-user system)
- Verify customer email is correct

### Access Control

- **RLS Policies**: Customer can only see their own sites (enforced by RLS)
- **Ownership Check**: API verifies site belongs to inviter before transfer
- **User Validation**: Only authenticated owners can invite customers

### Service Role Key

- API uses `adminClient` (service role) for user creation and site updates
- Service role key is **never exposed to client**
- All operations are server-side only

---

## 🛠️ Technical Details

### User Creation

If customer email doesn't exist in Supabase Auth:
- New user is created via `adminClient.auth.admin.createUser()`
- Email is auto-confirmed (`email_confirm: true`)
- User metadata includes:
  - `invited_by`: Owner's user ID
  - `invited_at`: Timestamp

If customer email already exists:
- Existing user is fetched
- No new user created
- Ownership transfer proceeds

### Magic Link Generation

- Generated via `adminClient.auth.admin.generateLink()`
- Type: `magiclink`
- Redirects to: `/dashboard`
- Expires after use or time limit

### Ownership Transfer

```sql
UPDATE sites 
SET user_id = <customer_user_id>
WHERE id = <site_id> AND user_id = <owner_user_id>
```

**Result**:
- Customer becomes site owner
- Original owner loses access
- RLS policies ensure customer only sees their sites

---

## ⚠️ Important Notes

### Single-Owner Model

Current implementation uses **single-owner** model:
- Each site has one `user_id` (owner)
- Inviting customer transfers ownership
- Original owner loses access

### Future: Multi-User Support

For multi-user access (owner + customers), would need:
- `site_members` table: `(site_id, user_id, role)`
- RLS policies updated to check membership
- UI to show multiple members per site

**Current Status**: Not implemented (MINIMAL approach chosen)

### Email Delivery

Magic link is generated but **not automatically sent**:
- API returns login URL in response
- Owner must share URL with customer manually
- Or integrate with email service (SendGrid, Resend, etc.)

---

## 🚨 Troubleshooting

### Issue: "Site not found or access denied"

**Cause**: Site doesn't belong to current owner, or site_id is invalid

**Solution**:
1. Verify you're logged in as the site owner
2. Check site_id is correct
3. Ensure site exists and belongs to you

### Issue: "Failed to create user"

**Cause**: Email format invalid, or Supabase Auth error

**Solution**:
1. Verify email format is correct
2. Check Supabase Auth is enabled
3. Verify service role key is correct

### Issue: Magic link generation fails

**Cause**: Supabase Auth configuration issue

**Solution**:
1. Link generation failure doesn't block invite
2. Customer can still log in via email/password
3. Or use password reset flow

### Issue: Customer can't access dashboard after invite

**Cause**: Ownership transfer succeeded but customer needs to log in

**Solution**:
1. Verify customer clicked magic link
2. Check customer is logged in with correct email
3. Verify RLS policies allow access
4. Check site ownership was transferred correctly

---

## 📝 API Reference

### POST /api/customers/invite

**Authentication**: Required (owner must be logged in)

**Request**:
```typescript
{
  email: string;      // Customer email address
  site_id: string;    // UUID of site to transfer
}
```

**Response (Success)**:
```typescript
{
  success: true;
  message: string;
  customer_email: string;
  site_name: string;
  login_url: string | null;  // Magic link (if generated)
  note: string;
}
```

**Response (Error)**:
```typescript
{
  error: string;
  details?: string;
}
```

**Status Codes**:
- `200`: Success
- `400`: Invalid request (missing fields, invalid email)
- `401`: Unauthorized (not logged in)
- `403`: Forbidden (site doesn't belong to owner)
- `500`: Server error

---

## 🔍 Verification

### Check Site Ownership

```sql
-- Verify site ownership after transfer
SELECT id, name, user_id, domain 
FROM sites 
WHERE id = '<site_id>';
```

### Check Customer User

```sql
-- Verify customer user exists
SELECT id, email, user_metadata 
FROM auth.users 
WHERE email = 'customer@example.com';
```

### Test Invite Flow

1. Create test site
2. Invite test customer email
3. Verify site `user_id` updated
4. Log in as customer
5. Verify customer can see site in dashboard

---

## 📊 Flow Diagram

```
Owner                    API                    Supabase Auth          Customer
  |                       |                          |                    |
  |-- Invite Request ---->|                          |                    |
  |                       |-- Verify Ownership ----->|                    |
  |                       |                          |                    |
  |                       |-- Create/Fetch User ----->|                   |
  |                       |<-- User Created ---------|                    |
  |                       |                          |                    |
  |                       |-- Update sites.user_id -->|                   |
  |                       |                          |                    |
  |                       |-- Generate Magic Link -->|                   |
  |                       |<-- Login URL ------------|                    |
  |<-- Success + URL -----|                          |                    |
  |                       |                          |                    |
  |-- Share URL ------------------------------------->|                    |
  |                       |                          |                    |
  |                       |                          |<-- Click Link ----|
  |                       |                          |-- Validate Token ->|
  |                       |                          |<-- Session -------|
  |                       |                          |                    |
  |                       |                          |-- Access Dashboard|
```

---

**Last Updated**: January 24, 2026  
**Version**: 1.0
