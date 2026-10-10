export function ErrorBox({ error }: { error: Error }) {
  return (
    <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
      Något gick fel: {error.message}
    </p>
  );
}