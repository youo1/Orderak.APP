package app.orderak.seller.feature.splash

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/**
 * The first thing the app draws, as a function of its state.
 *
 * WHY THIS FILE IS NEW FOR A SCREEN THAT HAS ALWAYS EXISTED
 *   Splash was an anonymous block inside `composable<SplashRoute> { }` in
 *   OrderakNavHost. It had no name, so nothing could render it, reference it,
 *   or check it — and `verify-screen-contracts` passed it only because the
 *   contract declares no actions, which makes its `bodyFor` lookup for a
 *   `SplashScreen()` that did not exist return early without complaining.
 *
 *   A screen with two declared states and no name is the least visible version
 *   of this repo's recurring problem.
 *
 * WHAT STAYS IN THE NAV HOST
 *   The LaunchedEffect that navigates on a decision. This screen renders the
 *   two states a seller can actually be looking at and knows nothing about
 *   routes — the resolved-and-leaving case is not a state, it is a transition.
 */
@Composable
fun SplashScreen(
    isError: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        if (isError) {
            Column(
                modifier = Modifier.fillMaxSize().padding(spacing.space6),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(stringResource(R.string.operations_error))
                Button(onClick = onRetry, modifier = Modifier.padding(top = spacing.space4)) {
                    Text(stringResource(R.string.common_retry))
                }
            }
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
    }
}
