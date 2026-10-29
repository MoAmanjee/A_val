# PayFast — restaurant setup

Send this link to a shop so they can open PayFast and send you the keys:

**`{APP_URL}/setup/payfast`**

Example: `https://your-tunnel.trycloudflare.com/setup/payfast`

On **`/ops`** use **Copy PayFast link** or **Copy WhatsApp invite** (full message ready to paste).

## What they send you

1. **Merchant ID**
2. **Merchant Key**
3. **Salt Passphrase** (if they set one)
4. **sandbox** or **live**

## What you do

1. Open **`/ops`** (ops PIN)
2. On that site’s card → **PayFast**
3. Paste Merchant ID + Key (+ passphrase)
4. Choose sandbox / live
5. Tick **PayFast on** when you are ready

Keys are encrypted at rest (`payfastMerchantKeyEnc`, `payfastPassphraseEnc`). The public guide never shows secrets.

## Links for the shop

- Sign up: https://www.payfast.co.za/user/register  
- Login: https://www.payfast.co.za/login  
- Dev docs: https://developers.payfast.co.za/docs  

Money settles in **their** PayFast / bank account after you wire checkout to these credentials.
