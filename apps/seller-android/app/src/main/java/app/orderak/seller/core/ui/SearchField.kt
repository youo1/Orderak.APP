package app.orderak.seller.core.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import app.orderak.seller.R

/**
 * The search box, wherever a seller filters a list they already have.
 *
 * Filtering happens over data already in Room, so it works with the network off
 * — which is the point rather than a side effect: the lists this sits above are
 * the seller's own records, and needing a connection to look through your own
 * customers would be the wrong behaviour on a market stall.
 *
 * The clear button is not decoration. Without it, a query that matches nothing
 * leaves the seller looking at an empty screen with no obvious way back to the
 * full list, and "my products are gone" is the reasonable reading.
 */
@Composable
fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = stringResource(R.string.search_clear),
                    )
                }
            }
        },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = modifier.fillMaxWidth(),
    )
}
