import { useState } from 'react'
import { Modal } from './Modal'
import type { CustomerDetailsInput } from '../../../shared/types'

interface Props {
  open: boolean
  title: string
  /**
   * Delivery demands every field; takeaway asks for nothing and accepts
   * whatever the customer volunteers. The main process enforces the delivery
   * rule again on save — this flag only decides what the form insists on
   * before letting the button go live.
   */
  mode: 'delivery' | 'takeaway'
  initial?: Partial<CustomerDetailsInput>
  submitLabel?: string
  onClose: () => void
  onSubmit: (details: CustomerDetailsInput) => Promise<boolean | void>
}

export function CustomerModal({
  open,
  title,
  mode,
  initial,
  submitLabel = 'Save',
  onClose,
  onSubmit
}: Props) {
  const [name, setName] = useState(initial?.customer_name ?? '')
  const [phone, setPhone] = useState(initial?.customer_phone ?? '')
  const [address, setAddress] = useState(initial?.delivery_address ?? '')
  const [saving, setSaving] = useState(false)

  const required = mode === 'delivery'
  const complete = !required || (name.trim() && phone.trim() && address.trim())

  const submit = async (): Promise<void> => {
    setSaving(true)
    try {
      const ok = await onSubmit({
        customer_name: name.trim() || null,
        customer_phone: phone.trim() || null,
        delivery_address: required ? address.trim() || null : null
      })
      if (ok !== false) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      subtitle={
        required
          ? 'The driver needs all three — nothing here is optional.'
          : 'Everything here is optional. Only fill in what the customer asks for.'
      }
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={!complete || saving}>
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Customer name"
          required={required}
          value={name}
          onChange={setName}
          placeholder={required ? '' : 'e.g. for calling out the order'}
          autoFocus
        />
        <Field
          label="Phone"
          required={required}
          value={phone}
          onChange={setPhone}
          placeholder="+94 7X XXX XXXX"
          mono
        />
        {required && (
          <div>
            <label className="label">
              Delivery address <span className="text-rose-400">*</span>
            </label>
            <textarea
              className="field resize-none"
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, building, floor — whatever the driver needs at the door"
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
  mono,
  autoFocus
}: {
  label: string
  required: boolean
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  autoFocus?: boolean
}) {
  return (
    <div>
      <label className="label">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      <input
        className={mono ? 'field font-mono' : 'field'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  )
}
