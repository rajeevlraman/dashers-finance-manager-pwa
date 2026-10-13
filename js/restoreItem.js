// restoreItem.js: writes ONE record from a backup file. Kept free of the DOM and
// with the database functions passed in, so it can be tested without a browser.
//
// Rule: update the record with the same id, otherwise add it. One special case: a
// fresh install already holds the default property expense categories, and their
// names must be unique, so adding the backup's copy fails with a ConstraintError.
// Nothing else in the app points at those rows by id (an expense keeps its category
// as a plain name), so the backup's copy replaces the local one. If the replacement
// itself fails, the local row is put back, so a failed restore never loses a category.

export async function restoreOneItem(deps, store, item) {
  const { updateItem, addItem, getAllItems, deleteItem, STORE_NAMES } = deps;
  try {
    await updateItem(store, item);
    return 'updated';
  } catch (_updateError) { /* not there yet: add it below */ }
  try {
    await addItem(store, item);
    return 'added';
  } catch (addError) {
    if (addError?.name !== 'ConstraintError' || store !== STORE_NAMES.propertyExpenseCategories || !item.categoryName) throw addError;
    const clash = (await getAllItems(store)).find(r => r.categoryName === item.categoryName && r.id !== item.id);
    if (!clash) throw addError;
    await deleteItem(store, clash.id);
    try {
      await addItem(store, item);
    } catch (replaceError) {
      await addItem(store, clash).catch(() => {});   // put the original back
      throw replaceError;
    }
    return 'replaced';
  }
}
