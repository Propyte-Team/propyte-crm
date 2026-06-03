"use client";
export default function CapturaFormClient(props: { token: string; label: string; isUpdate: boolean }) {
  return <div>Formulario {props.label} ({props.token})</div>;
}
